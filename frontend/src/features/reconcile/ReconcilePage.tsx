import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { ApiRequestError } from '../../api/client'
import { queryKeys } from '../../api/keys'
import {
  fetchReconciliations,
  fetchWorksheet,
  finishReconciliation,
  undoReconciliation,
} from '../../api/reconcile'
import type { Reconciliation, Worksheet } from '../../api/reconcile'
import { updateTransaction } from '../../api/transactions'
import type { Transaction } from '../../api/transactions'
import { AmountInput } from '../../components/AmountInput'
import { Combobox } from '../../components/Combobox'
import type { ComboOption } from '../../components/Combobox'
import { DateInput } from '../../components/DateInput'
import { useToast } from '../../components/toastContext'
import { evaluateAmount } from '../../lib/amountExpr'
import { isValidIsoDate, parseDateInput, todayIso } from '../../lib/dates'
import { formatCents } from '../../lib/money'
import { centsToInput } from '../ledger/draft'
import { useReferenceData } from '../ledger/useLedgerData'
import { difference, statementCents, typedCents } from './reconcileMath'

const FIELD =
  'mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:bg-slate-950'
const PRIMARY =
  'rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900'
const SECONDARY =
  'rounded border border-slate-300 px-3 py-1.5 text-sm outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800'

/** Everything finishing or undoing a reconciliation can change. */
const AFFECTED = [
  queryKeys.transactions,
  queryKeys.balances,
  queryKeys.budgets,
  queryKeys.dashboard,
  queryKeys.reconcile,
  queryKeys.payees,
]

type Statement = { date: string; typedCents: number }

/** The statement being worked on survives leaving the page (the ticks are on the server). */
function draftKey(accountId: number) {
  return `pb.reconcile.${accountId}`
}

function loadDraft(accountId: number): Statement | null {
  try {
    const raw = window.localStorage.getItem(draftKey(accountId))
    const parsed = raw ? (JSON.parse(raw) as Statement) : null
    return parsed && isValidIsoDate(parsed.date) && Number.isInteger(parsed.typedCents)
      ? parsed
      : null
  } catch {
    return null
  }
}

function saveDraft(accountId: number, statement: Statement | null) {
  try {
    if (statement) window.localStorage.setItem(draftKey(accountId), JSON.stringify(statement))
    else window.localStorage.removeItem(draftKey(accountId))
  } catch {
    // Private windows and blocked storage: the page still works, it just forgets.
  }
}

function errorText(error: unknown): string {
  return error instanceof ApiRequestError ? error.detail : 'That did not work.'
}

function signedInput(cents: number): string {
  return `${cents < 0 ? '-' : ''}${centsToInput(cents)}`
}

/** Reconcile an account to a bank statement (SPEC §12). */
export function ReconcilePage() {
  const params = useParams()
  const accountId = Number(params.accountId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const reference = useReferenceData()
  const account = reference.accounts.find((item) => item.id === accountId)
  const liability = account?.is_liability ?? false

  const [statement, setStatement] = useState<Statement | null>(() => loadDraft(accountId))
  const [dateText, setDateText] = useState(statement?.date ?? todayIso())
  const [balanceText, setBalanceText] = useState(statement ? signedInput(statement.typedCents) : '')
  const [formError, setFormError] = useState<string | null>(null)
  const [categoryText, setCategoryText] = useState('')
  const [categoryId, setCategoryId] = useState<number | null>(null)

  const history = useQuery({
    queryKey: queryKeys.reconciliations(accountId),
    queryFn: ({ signal }) => fetchReconciliations(accountId, signal),
  })
  const sheetKey = queryKeys.worksheet(accountId, statement?.date ?? '')
  const sheet = useQuery({
    queryKey: sheetKey,
    queryFn: ({ signal }) => fetchWorksheet(accountId, statement?.date ?? '', signal),
    enabled: statement !== null,
    retry: false,
  })

  const refresh = () => {
    for (const key of AFFECTED) void queryClient.invalidateQueries({ queryKey: key })
  }

  const tick = useMutation({
    mutationFn: ({ row, status }: { row: Transaction; status: 'cleared' | 'uncleared' }) =>
      updateTransaction(row.id, { status }),
    onMutate: async ({ row, status }) => {
      await queryClient.cancelQueries({ queryKey: sheetKey })
      const previous = queryClient.getQueryData<Worksheet>(sheetKey)
      if (previous) {
        queryClient.setQueryData<Worksheet>(sheetKey, {
          ...previous,
          rows: previous.rows.map((item) => (item.id === row.id ? { ...item, status } : item)),
        })
      }
      return { previous }
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(sheetKey, context.previous)
      toast(errorText(error))
    },
    onSuccess: () => {
      // The worksheet is already right; the ledger and balances catch up in the background.
      void queryClient.invalidateQueries({ queryKey: queryKeys.balances })
      void queryClient.invalidateQueries({ queryKey: queryKeys.transactions })
    },
  })

  const finish = useMutation({
    mutationFn: (adjust: boolean) => {
      if (!statement) throw new Error('No statement')
      return finishReconciliation(accountId, {
        statement_date: statement.date,
        statement_balance_cents: statementCents(statement.typedCents, liability),
        adjust,
        adjustment_category_id: adjust ? categoryId : null,
      })
    },
    onSuccess: ({ reconciliation }) => {
      saveDraft(accountId, null)
      refresh()
      toast(
        `Reconciled to ${reconciliation.statement_date}: ${reconciliation.transaction_count} transactions locked.`,
        'success',
      )
      navigate(`/transactions/${accountId}`)
    },
    onError: (error) => toast(errorText(error)),
  })

  const undo = useMutation({
    mutationFn: (record: Reconciliation) => undoReconciliation(record.id),
    onSuccess: ({ reconciliation }) => {
      refresh()
      toast(`Undid the reconciliation to ${reconciliation.statement_date}.`, 'success')
    },
    onError: (error) => toast(errorText(error)),
  })

  const categoryOptions = useMemo<ComboOption[]>(
    () =>
      reference.categories.map((category) => ({
        key: String(category.id),
        label: category.name,
        group: category.groupName,
      })),
    [reference.categories],
  )

  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const date = parseDateInput(dateText, todayIso())
    const cents = balanceText.trim() ? evaluateAmount(balanceText) : null
    if (!date) {
      setFormError('Type the statement date, e.g. 2026-09-30.')
      return
    }
    if (cents === null) {
      setFormError(`Type the statement's ${liability ? 'amount owed' : 'ending balance'}.`)
      return
    }
    setFormError(null)
    const next = { date, typedCents: cents }
    saveDraft(accountId, next)
    setStatement(next)
  }

  function change() {
    saveDraft(accountId, null)
    setStatement(null)
  }

  function payeeLabel(row: Transaction): string {
    if (row.transfer_account_id !== null) {
      const other = reference.accounts.find((item) => item.id === row.transfer_account_id)
      return `Transfer: ${other?.name ?? '?'}`
    }
    return reference.payees.find((payee) => payee.id === row.payee_id)?.name ?? ''
  }

  function moveFocus(event: KeyboardEvent<HTMLTableSectionElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const boxes = Array.from(
      event.currentTarget.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    )
    const index = boxes.indexOf(document.activeElement as HTMLInputElement)
    if (index < 0) return
    event.preventDefault()
    boxes[
      Math.max(0, Math.min(boxes.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
    ]?.focus()
  }

  if (reference.loading) return <p className="text-sm text-slate-500">Loading…</p>
  if (!account) return <p className="text-sm text-slate-500">That account does not exist.</p>
  if (account.valuation_mode === 'manual')
    return (
      <p className="text-sm text-slate-500">
        {account.name}'s balance is typed in, so there is nothing to reconcile.
      </p>
    )

  const data = sheet.data
  const statementBalance = statement ? statementCents(statement.typedCents, liability) : 0
  const gap = data ? difference(statementBalance, data.reconciled_cents, data.rows) : 0
  const ticked = data ? data.rows.filter((row) => row.status === 'cleared').length : 0
  const shown = (cents: number) => formatCents(typedCents(cents, liability))
  const busy = finish.isPending || tick.isPending

  return (
    <section className="max-w-4xl">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Reconcile {account.name}</h1>
        <Link
          to={`/transactions/${accountId}`}
          className="text-sm text-sky-700 underline dark:text-sky-300"
        >
          Back to the ledger
        </Link>
      </div>

      {statement === null ? (
        <form
          onSubmit={start}
          className="mt-4 grid max-w-xl gap-4 sm:grid-cols-2"
          aria-label="Statement"
          data-testid="statement-form"
        >
          <label>
            <span className="block text-sm font-medium">Statement date</span>
            <DateInput
              aria-label="Statement date"
              value={dateText}
              onChange={setDateText}
              className={FIELD}
            />
          </label>
          <label>
            <span className="block text-sm font-medium">
              {liability ? 'Amount owed on the statement' : 'Ending balance on the statement'}
            </span>
            <AmountInput
              aria-label="Statement balance"
              value={balanceText}
              onChange={setBalanceText}
              className={FIELD}
            />
          </label>
          {liability && (
            <p className="text-xs text-slate-500 sm:col-span-2">
              Type it the way the statement shows it: $512.30 owed is 512.30.
            </p>
          )}
          {history.data?.items[0] && (
            <p className="text-xs text-slate-500 sm:col-span-2">
              Last reconciled to {history.data.items[0].statement_date} at{' '}
              {shown(history.data.items[0].statement_balance_cents)}.
            </p>
          )}
          {formError && (
            <p role="alert" className="text-sm text-rose-600 sm:col-span-2">
              {formError}
            </p>
          )}
          <div className="sm:col-span-2">
            <button type="submit" className={PRIMARY}>
              Start reconciling
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-4" data-testid="worksheet">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
            <span>
              Statement of <span className="font-medium">{statement.date}</span>:{' '}
              <span className="font-medium tabular-nums">{formatCents(statement.typedCents)}</span>
              {liability && ' owed'}
            </span>
            <button
              type="button"
              onClick={change}
              className="text-xs text-sky-700 underline dark:text-sky-300"
            >
              Change
            </button>
          </div>

          {sheet.error && <p className="mt-3 text-sm text-rose-600">{errorText(sheet.error)}</p>}
          {data && (
            <>
              <div
                className={`mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded border px-3 py-2 text-sm ${
                  gap === 0
                    ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40'
                    : 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40'
                }`}
                data-testid="reconcile-summary"
              >
                <span>
                  Cleared balance{' '}
                  <span className="font-medium tabular-nums">{shown(statementBalance - gap)}</span>
                </span>
                <span>
                  Difference{' '}
                  <span
                    className="font-semibold tabular-nums"
                    data-testid="reconcile-difference"
                    aria-live="polite"
                  >
                    {formatCents(gap)}
                  </span>
                </span>
                <span className="text-slate-500">
                  {ticked} of {data.rows.length} ticked
                </span>
              </div>

              {data.rows.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">Nothing open up to {statement.date}.</p>
              ) : (
                <table className="mt-3 w-full text-sm" data-testid="reconcile-table">
                  <thead className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800">
                    <tr>
                      <th className="w-8 py-1" />
                      <th className="py-1 pr-2 font-medium">Date</th>
                      <th className="py-1 pr-2 font-medium">Payee</th>
                      <th className="py-1 pr-2 font-medium">Memo</th>
                      <th className="py-1 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody onKeyDown={moveFocus}>
                    {data.rows.map((row, index) => {
                      const checked = row.status === 'cleared'
                      return (
                        <tr
                          key={row.id}
                          className={`border-b border-slate-100 dark:border-slate-800/70 ${checked ? '' : 'text-slate-500'}`}
                          data-testid="reconcile-row"
                        >
                          <td className="py-1">
                            <input
                              type="checkbox"
                              autoFocus={index === 0}
                              aria-label={`Cleared: ${row.date} ${payeeLabel(row)} ${formatCents(row.amount_cents)}`}
                              checked={checked}
                              onChange={(event) =>
                                tick.mutate({
                                  row,
                                  status: event.target.checked ? 'cleared' : 'uncleared',
                                })
                              }
                            />
                          </td>
                          <td className="py-1 pr-2 whitespace-nowrap tabular-nums">{row.date}</td>
                          <td className="py-1 pr-2">{payeeLabel(row)}</td>
                          <td className="py-1 pr-2 text-slate-500">{row.memo}</td>
                          <td
                            className={`py-1 text-right tabular-nums ${row.amount_cents > 0 ? 'text-emerald-700 dark:text-emerald-400' : ''}`}
                          >
                            {formatCents(row.amount_cents)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
              <p className="mt-2 text-xs text-slate-500">
                Tick what is on the statement (Space; ↑/↓ to move). Ticks are saved as you go.
              </p>

              <div className="mt-4 flex flex-wrap items-end gap-3">
                <button
                  type="button"
                  disabled={gap !== 0 || busy}
                  onClick={() => finish.mutate(false)}
                  className={PRIMARY}
                >
                  Finish
                </button>
                {gap !== 0 && (
                  <>
                    <div className="w-56">
                      <span className="block text-xs text-slate-500">
                        Adjustment category (optional)
                      </span>
                      <Combobox
                        aria-label="Adjustment category"
                        options={categoryOptions}
                        text={categoryText}
                        onTextChange={(text) => {
                          setCategoryText(text)
                          setCategoryId(null)
                        }}
                        onPick={(option) => {
                          setCategoryText(option.label)
                          setCategoryId(Number(option.key))
                        }}
                        className={FIELD}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      className={SECONDARY}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Add a ${formatCents(gap)} "Reconciliation adjustment" dated ${statement.date} and finish?`,
                          )
                        )
                          finish.mutate(true)
                      }}
                    >
                      Finish with a {formatCents(gap)} adjustment
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <h2 className="mt-10 text-sm font-semibold">Reconciliation history</h2>
      {history.data && history.data.items.length === 0 && (
        <p className="mt-2 text-sm text-slate-500">Not reconciled yet.</p>
      )}
      {history.data && history.data.items.length > 0 && (
        <table className="mt-2 w-full text-sm" data-testid="reconcile-history">
          <thead className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800">
            <tr>
              <th className="py-1 pr-2 font-medium">Statement</th>
              <th className="py-1 pr-2 text-right font-medium">{liability ? 'Owed' : 'Balance'}</th>
              <th className="py-1 pr-2 text-right font-medium">Transactions</th>
              <th className="py-1 pr-2 text-right font-medium">Adjustment</th>
              <th className="py-1 pr-2 font-medium">Finished</th>
              <th className="py-1 font-medium" />
            </tr>
          </thead>
          <tbody>
            {history.data.items.map((record, index) => (
              <tr key={record.id} className="border-b border-slate-100 dark:border-slate-800/70">
                <td className="py-1 pr-2 tabular-nums">{record.statement_date}</td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {shown(record.statement_balance_cents)}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{record.transaction_count}</td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {record.adjustment_cents === null ? '' : formatCents(record.adjustment_cents)}
                </td>
                <td className="py-1 pr-2 text-slate-500">
                  {new Date(record.completed_at).toLocaleDateString()}
                </td>
                <td className="py-1 text-right">
                  {index === 0 && (
                    <button
                      type="button"
                      disabled={undo.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Undo the reconciliation to ${record.statement_date}? Its transactions go back to cleared${record.adjustment_cents === null ? '' : ' and its adjustment is deleted'}.`,
                          )
                        )
                          undo.mutate(record)
                      }}
                      className="rounded px-2 text-xs text-rose-600 underline outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                    >
                      Undo
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
