import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useRef, useState } from 'react'
import { NavLink, useParams, useSearchParams } from 'react-router-dom'

import type { Account } from '../../api/accounts'
import { queryKeys } from '../../api/keys'
import { fetchBill, payBill } from '../../api/subscriptions'
import type { Bill } from '../../api/subscriptions'
import type { BillMatch, LedgerFilters, Transaction } from '../../api/transactions'
import { useToast } from '../../components/toastContext'
import { useRowNavigation } from '../../components/useRowNavigation'
import { isValidIsoDate, todayIso } from '../../lib/dates'
import { formatCents } from '../../lib/money'
import { EntryRow } from './EntryRow'
import type { EntryRowHandle } from './EntryRow'
import { FilterBar } from './FilterBar'
import { flatRows } from './ledgerCache'
import { LedgerTable } from './LedgerTable'
import { ShortcutOverlay } from './ShortcutOverlay'
import { buildSave, draftAmount, draftFromBill, draftFromTransaction, emptyDraft } from './draft'
import type { Draft, Lookups } from './draft'
import {
  errorMessage,
  isReconciledConfirm,
  useLedgerMutations,
  useLedgerQuery,
  useReferenceData,
} from './useLedgerData'
import type { UpdateVars } from './useLedgerData'

/** The ledger: one account at /transactions/:accountId, every account at /transactions. */
export function LedgerPage() {
  const { accountId: param } = useParams()
  const [search] = useSearchParams()
  const accountId = param === undefined ? null : Number(param)
  const reference = useReferenceData()
  const account = reference.accounts.find((row) => row.id === accountId)
  // "Mark paid" from the calendar arrives as ?bill=<occurrence id>.
  const billId = Number(search.get('bill')) || null
  const bill = useQuery({
    queryKey: queryKeys.bill(billId ?? 0),
    queryFn: ({ signal }) => fetchBill(billId!, signal),
    enabled: billId !== null,
  })

  if (reference.loading || (billId !== null && bill.isPending)) {
    return <p className="text-sm text-slate-500">Loading…</p>
  }
  if (accountId !== null && account === undefined) {
    return <p className="text-sm text-slate-500">That account does not exist.</p>
  }
  // Keyed so switching accounts starts with a clean entry row and selection.
  return (
    <LedgerView
      key={`${accountId ?? 'all'}?${search.toString()}`}
      account={account ?? null}
      reference={reference}
      linked={linkedFilters(search)}
      bill={bill.data?.status === 'upcoming' ? bill.data : null}
    />
  )
}

type Reference = ReturnType<typeof useReferenceData>

/** Filters a link can open the ledger with: ?from=&to=&uncategorized=1&on_budget=1. */
type Linked = { from?: string; to?: string; uncategorized?: boolean; onBudget?: boolean }

function linkedFilters(search: URLSearchParams): Linked {
  const linked: Linked = {}
  const from = search.get('from')
  const to = search.get('to')
  if (from && isValidIsoDate(from)) linked.from = from
  if (to && isValidIsoDate(to)) linked.to = to
  if (search.get('uncategorized') === '1') linked.uncategorized = true
  if (search.get('on_budget') === '1') linked.onBudget = true
  return linked
}

function AccountTabs({
  accounts,
  balances,
}: {
  accounts: Account[]
  balances: Reference['balances']
}) {
  const balanceOf = (id: number) => balances.find((row) => row.account_id === id)?.current_cents
  const tab = ({ isActive }: { isActive: boolean }) =>
    [
      'shrink-0 rounded px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500',
      isActive
        ? 'bg-slate-200 font-medium dark:bg-slate-800'
        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/60',
    ].join(' ')
  return (
    <nav className="mb-3 flex gap-1 overflow-x-auto" aria-label="Accounts">
      <NavLink to="/transactions" end className={tab}>
        All accounts
      </NavLink>
      {accounts
        .filter((account) => !account.is_closed)
        .map((account) => {
          const balance = balanceOf(account.id)
          return (
            <NavLink key={account.id} to={`/transactions/${account.id}`} className={tab}>
              {account.name}
              {balance !== undefined && (
                <span
                  className={`ml-1.5 text-xs tabular-nums ${balance < 0 ? 'text-rose-600' : 'text-slate-500'}`}
                  data-testid={`tab-balance-${account.id}`}
                >
                  {formatCents(balance)}
                </span>
              )}
            </NavLink>
          )
        })}
    </nav>
  )
}

function LedgerView({
  account,
  reference,
  linked,
  bill,
}: {
  account: Account | null
  reference: Reference
  linked: Linked
  bill: Bill | null
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const accountId = account?.id ?? null
  // Scope filters come only from a link and sit outside the filter bar.
  const [scope, setScope] = useState<LedgerFilters>(() => {
    const initial: LedgerFilters = {}
    if (linked.uncategorized) initial.uncategorized = true
    if (linked.onBudget) initial.onBudget = true
    return initial
  })
  const [barFilters, setBarFilters] = useState<LedgerFilters>(() => {
    const initial: LedgerFilters = {}
    if (linked.from) initial.from = linked.from
    if (linked.to) initial.to = linked.to
    return initial
  })
  const filters = useMemo(() => ({ ...barFilters, ...scope }), [barFilters, scope])
  const ledger = useLedgerQuery(accountId, filters)
  const mutations = useLedgerMutations(
    { accountId, filters, account: account ?? undefined },
    reference.payees,
  )

  const today = todayIso()
  const lookups: Lookups = useMemo(
    () => ({
      accounts: reference.accounts,
      payees: reference.payees,
      categories: reference.categories,
      today,
    }),
    [reference.accounts, reference.payees, reference.categories, today],
  )

  const [draft, setDraft] = useState<Draft>(() =>
    bill ? draftFromBill(bill, lookups, account) : emptyDraft(today, account),
  )
  // The bill this entry row is paying, until it saves or is cleared.
  const [paying, setPaying] = useState<Bill | null>(bill)
  const entryRef = useRef<EntryRowHandle>(null)
  const editRef = useRef<EntryRowHandle>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState<Draft>(() => emptyDraft(today))
  const [showHelp, setShowHelp] = useState(false)
  const lastDeleted = useRef<Transaction | null>(null)

  const rows = flatRows(ledger.data)
  const ids = rows.map((row) => row.transaction.id)
  const balance = reference.balances.find((row) => row.account_id === accountId)

  const applyFilters = useCallback((next: LedgerFilters) => {
    setBarFilters((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next))
  }, [])

  // ------------------------------------------------------------------ new entries

  function saveNew() {
    const built = buildSave(draft, lookups)
    if (!built.ok) {
      toast(built.message)
      entryRef.current?.focus(built.field)
      return
    }
    const typed = draft
    const plannedAccount = built.plan.kind === 'transaction' ? built.plan.body.account_id : null
    const keptAccount =
      account ?? reference.accounts.find((row) => row.id === plannedAccount) ?? null
    // SPEC §7: clear the row, keep the date, and go back to Payee for the next receipt.
    const cleared = emptyDraft(built.plan.body.date, account)
    if (account === null && built.plan.kind === 'transaction' && keptAccount) {
      cleared.accountId = keptAccount.id
      cleared.accountText = keptAccount.name
    } else if (account === null && built.plan.kind === 'transfer') {
      cleared.accountId = typed.accountId
      cleared.accountText = typed.accountText
    }
    setDraft(cleared)
    entryRef.current?.focus('payee')

    const bill = paying
    const plan =
      bill && built.plan.kind === 'transaction'
        ? {
            ...built.plan,
            body: { ...built.plan.body, subscription_occurrence_id: bill.occurrence_id },
          }
        : built.plan
    setPaying(null)

    mutations.create.mutate(plan, {
      onSuccess: ({ result }) => {
        if (result.paid_occurrence_id && bill) {
          toast(`Marked ${bill.name} due ${bill.due_date} paid.`, 'success')
        } else if (result.bill_match && result.transactions[0]) {
          offerLink(result.bill_match, result.transactions[0].id)
        }
      },
      onError: (error) => {
        // The server said no: the row comes back exactly as it was typed.
        setDraft(typed)
        setPaying(bill)
        toast(errorMessage(error))
        entryRef.current?.focus('payee')
      },
    })
  }

  /** SPEC §9: a save that looks like a bill payment offers to link it. */
  function offerLink(match: BillMatch, transactionId: number) {
    toast(`Looks like ${match.name} due ${match.due_date}.`, 'success', {
      durationMs: 10_000,
      action: {
        label: 'Link',
        onClick: () =>
          void payBill(match.occurrence_id, transactionId)
            .then(() => {
              toast(`Marked ${match.name} paid.`, 'success')
              for (const key of [
                queryKeys.bills,
                queryKeys.subscriptions,
                queryKeys.budgets,
                queryKeys.dashboard,
              ]) {
                void queryClient.invalidateQueries({ queryKey: key })
              }
            })
            .catch((error: unknown) => toast(errorMessage(error))),
      },
    })
  }

  function cancelNew() {
    const blank = emptyDraft(draft.date, account)
    const isBlank =
      !draft.payeeText && !draft.categoryText && !draft.memo && !draft.outflow && !draft.inflow
    setPaying(null)
    if (isBlank) {
      // Nothing left to clear: step out of the row so the row shortcuts work.
      ;(document.activeElement as HTMLElement | null)?.blur()
      return
    }
    setDraft({ ...blank, accountId: draft.accountId, accountText: draft.accountText })
    entryRef.current?.focus(account === null ? 'account' : 'date')
  }

  // ----------------------------------------------------------------- inline edits

  function openEditor(id: number) {
    const row = mutations.find(id)
    if (row === undefined || id < 0) return
    setSelectedId(id)
    setEditDraft(draftFromTransaction(row, lookups))
    setEditingId(id)
    window.setTimeout(() => editRef.current?.focus('payee'), 0)
  }

  function closeEditor() {
    const id = editingId
    setEditingId(null)
    setSelectedId(id)
  }

  function runUpdate(vars: UpdateVars, reopenWith?: Draft) {
    mutations.update.mutate(vars, {
      onError: (error) => {
        if (isReconciledConfirm(error) && !vars.confirm) {
          if (window.confirm(`${errorMessage(error)}\n\nChange it anyway?`)) {
            runUpdate({ ...vars, confirm: true }, reopenWith)
          }
          return
        }
        toast(errorMessage(error))
        if (reopenWith) {
          setEditDraft(reopenWith)
          setEditingId(vars.id)
          window.setTimeout(() => editRef.current?.focus('payee'), 0)
        }
      },
    })
  }

  function saveEdit() {
    const row = editingId === null ? undefined : mutations.find(editingId)
    if (row === undefined) return closeEditor()
    const built = buildSave(editDraft, lookups)
    if (!built.ok) {
      toast(built.message)
      editRef.current?.focus(built.field)
      return
    }
    const typed = editDraft
    const plan = built.plan

    if (row.transfer_id !== null) {
      if (plan.kind !== 'transfer') {
        toast('To turn a transfer into a regular transaction, delete it and enter it again.')
        return
      }
      const partner =
        plan.body.from_account_id === row.account_id
          ? plan.body.to_account_id
          : plan.body.from_account_id
      if (partner !== row.transfer_account_id) {
        toast('To move a transfer to another account, delete it and enter it again.')
        return
      }
      closeEditor()
      runUpdate(
        {
          id: row.id,
          body: {
            date: plan.body.date,
            memo: plan.body.memo ?? null,
            amount_cents: draftAmount(editDraft) ?? row.amount_cents,
          },
        },
        typed,
      )
      return
    }
    if (plan.kind === 'transfer') {
      toast('To turn this into a transfer, delete it and enter the transfer.')
      return
    }
    closeEditor()
    runUpdate({ id: row.id, body: plan.body, newPayeeName: plan.newPayeeName }, typed)
  }

  // --------------------------------------------------------------- row shortcuts

  function toggleCleared(id: number | null) {
    const row = id === null ? undefined : mutations.find(id)
    if (row === undefined || row.id < 0) return
    if (row.status === 'reconciled') {
      toast('This transaction is reconciled. Reconciliation arrives in a later phase.')
      return
    }
    runUpdate({ id: row.id, body: { status: row.status === 'cleared' ? 'uncleared' : 'cleared' } })
  }

  function restore(row: Transaction) {
    const status = row.status
    if (row.transfer_id !== null && row.transfer_account_id !== null) {
      const outgoing = row.amount_cents < 0
      mutations.create.mutate(
        {
          kind: 'transfer',
          body: {
            from_account_id: outgoing ? row.account_id : row.transfer_account_id,
            to_account_id: outgoing ? row.transfer_account_id : row.account_id,
            date: row.date,
            amount_cents: Math.abs(row.amount_cents),
            category_id: row.splits[0]?.category_id ?? null,
            memo: row.memo,
            status,
          },
        },
        { onError: (error) => toast(errorMessage(error)) },
      )
      return
    }
    mutations.create.mutate(
      {
        kind: 'transaction',
        newPayeeName: null,
        body: {
          account_id: row.account_id,
          date: row.date,
          amount_cents: row.amount_cents,
          payee_id: row.payee_id,
          memo: row.memo,
          status,
          splits: row.splits.map((split) => ({
            amount_cents: split.amount_cents,
            category_id: split.category_id,
            memo: split.memo,
          })),
        },
      },
      { onError: (error) => toast(errorMessage(error)) },
    )
  }

  function undoDelete() {
    const row = lastDeleted.current
    if (row === null) return
    lastDeleted.current = null
    restore(row)
  }

  function deleteRow(id: number | null, confirm = false) {
    const row = id === null ? undefined : mutations.find(id)
    if (row === undefined || row.id < 0) return
    const index = ids.indexOf(row.id)
    const next = ids[index + 1] ?? ids[index - 1] ?? null
    setSelectedId(next)
    mutations.remove.mutate(
      { row, confirm },
      {
        onSuccess: () => {
          lastDeleted.current = row
          toast(row.transfer_id ? 'Transfer deleted.' : 'Transaction deleted.', 'success', {
            action: { label: 'Undo', onClick: undoDelete },
          })
          window.setTimeout(() => {
            if (lastDeleted.current === row) lastDeleted.current = null
          }, 5000)
        },
        onError: (error) => {
          setSelectedId(row.id)
          if (isReconciledConfirm(error) && !confirm) {
            if (window.confirm(`${errorMessage(error)}\n\nDelete it anyway?`))
              deleteRow(row.id, true)
            return
          }
          toast(errorMessage(error))
        },
      },
    )
  }

  useRowNavigation({
    ids,
    selected: selectedId,
    onSelect: setSelectedId,
    onOpen: openEditor,
    enabled: editingId === null && !showHelp,
    keys: {
      n: () => entryRef.current?.focus(account === null ? 'account' : 'date'),
      '/': () => searchRef.current?.focus(),
      '?': () => setShowHelp(true),
      c: toggleCleared,
      Delete: (id) => deleteRow(id),
      Backspace: (id) => deleteRow(id),
      u: undoDelete,
    },
  })

  const filtered = Object.keys(filters).length > 0
  const firstPage = ledger.data?.pages[0]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <AccountTabs accounts={reference.accounts} balances={reference.balances} />
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">{account?.name ?? 'All accounts'}</h1>
        <div className="flex items-baseline gap-4 text-sm">
          {balance && (
            <>
              <span>
                <span className="text-slate-500">Balance </span>
                <span
                  className={`font-semibold tabular-nums ${balance.current_cents < 0 ? 'text-rose-600' : ''}`}
                  data-testid="account-balance"
                >
                  {formatCents(balance.current_cents)}
                </span>
              </span>
              <span className="text-slate-500">
                Cleared <span className="tabular-nums">{formatCents(balance.cleared_cents)}</span>
              </span>
            </>
          )}
          {filtered && firstPage && (
            <span className="text-slate-500">
              Filtered total{' '}
              <span className="tabular-nums">{formatCents(firstPage.total_cents)}</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowHelp(true)}
            className="rounded px-1.5 text-xs text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
            title="Keyboard shortcuts (?)"
          >
            ? Shortcuts
          </button>
        </div>
      </div>
      <FilterBar
        onChange={applyFilters}
        payees={reference.payees}
        categories={reference.categories}
        searchRef={searchRef}
        initialFrom={linked.from}
        initialTo={linked.to}
      />
      {Object.keys(scope).length > 0 && (
        <div className="mb-2 flex items-center gap-2 text-sm" data-testid="scope-filter">
          <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100">
            {scope.uncategorized ? 'Uncategorized only' : 'Filtered'}
            {scope.onBudget ? ' · budget accounts' : ''}
          </span>
          <button
            type="button"
            onClick={() => setScope({})}
            className="rounded px-1.5 text-xs text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
          >
            Show all
          </button>
        </div>
      )}
      {paying && (
        <div className="mb-2 flex items-center gap-2 text-sm" data-testid="paying-bill">
          <span className="rounded bg-sky-100 px-2 py-0.5 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100">
            Paying {paying.name} due {paying.due_date} · Enter saves and marks it paid
          </span>
          <button
            type="button"
            onClick={() => setPaying(null)}
            className="rounded px-1.5 text-xs text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
          >
            Don’t link
          </button>
        </div>
      )}
      {ledger.isError ? (
        <p className="text-sm text-rose-600">{errorMessage(ledger.error)}</p>
      ) : (
        <LedgerTable
          rows={rows}
          showAccount={account === null}
          accounts={reference.accounts}
          payees={reference.payees}
          categoryNames={reference.categoryNames}
          selectedId={selectedId}
          editingId={editingId}
          onSelect={setSelectedId}
          onOpen={openEditor}
          onToggleCleared={toggleCleared}
          hasMore={ledger.hasNextPage}
          loadingMore={ledger.isFetchingNextPage}
          onLoadMore={() => void ledger.fetchNextPage()}
          header={
            <EntryRow
              mode="new"
              draft={draft}
              setDraft={setDraft}
              lookups={lookups}
              fixedAccount={account}
              prefillLastAmount={reference.prefillLastAmount}
              onSave={saveNew}
              onCancel={cancelNew}
              handleRef={entryRef}
            />
          }
          renderEditor={() => (
            <EntryRow
              mode="edit"
              draft={editDraft}
              setDraft={setEditDraft}
              lookups={lookups}
              fixedAccount={account}
              prefillLastAmount={false}
              onSave={saveEdit}
              onCancel={closeEditor}
              handleRef={editRef}
            />
          )}
        />
      )}
      {showHelp && <ShortcutOverlay onClose={() => setShowHelp(false)} />}
    </div>
  )
}
