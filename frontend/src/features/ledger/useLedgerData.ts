/** Server state for the ledger screen: reference data, the ledger pages, and the
 * optimistic mutations described in ARCHITECTURE §Frontend ("Optimistic pattern").
 */

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import { fetchAccounts } from '../../api/accounts'
import type { Account } from '../../api/accounts'
import { fetchGroups } from '../../api/categories'
import { ApiRequestError } from '../../api/client'
import { queryKeys } from '../../api/keys'
import { createPayee, fetchPayees } from '../../api/payees'
import type { Payee } from '../../api/payees'
import { fetchSettings } from '../../api/settings'
import {
  createTransaction,
  createTransfer,
  deleteTransaction,
  fetchBalances,
  fetchLedger,
  hasActiveFilters,
  updateTransaction,
} from '../../api/transactions'
import type {
  Balance,
  LedgerFilters,
  MutationResult,
  Transaction,
  TransactionInput,
  TransactionStatus,
} from '../../api/transactions'
import type { CategoryOption, SavePlan } from './draft'
import {
  applyBalances,
  findRow,
  flatRows,
  removeRows,
  shiftBalance,
  upsertRows,
  withRunningBalances,
} from './ledgerCache'
import type { LedgerData } from './ledgerCache'

/** Reference data changes rarely and typeahead reads it from memory (SPEC §7). */
const REFERENCE_STALE_MS = 5 * 60_000

export const payeeListKey = [...queryKeys.payees, ''] as const

export function useReferenceData() {
  const accounts = useQuery({
    queryKey: queryKeys.accounts,
    queryFn: ({ signal }) => fetchAccounts(signal),
    staleTime: REFERENCE_STALE_MS,
  })
  const payees = useQuery({
    queryKey: payeeListKey,
    queryFn: ({ signal }) => fetchPayees('', signal),
    staleTime: REFERENCE_STALE_MS,
  })
  const groups = useQuery({
    queryKey: queryKeys.categoryGroups,
    queryFn: ({ signal }) => fetchGroups(signal),
    staleTime: REFERENCE_STALE_MS,
  })
  const balances = useQuery({
    queryKey: queryKeys.balances,
    queryFn: ({ signal }) => fetchBalances(signal),
  })
  const settings = useQuery({
    queryKey: queryKeys.settings,
    queryFn: ({ signal }) => fetchSettings(signal),
    staleTime: REFERENCE_STALE_MS,
  })

  const categories = useMemo<CategoryOption[]>(
    () =>
      (groups.data?.items ?? [])
        .filter((group) => !group.is_hidden)
        .flatMap((group) =>
          group.categories
            .filter((category) => !category.is_hidden)
            .map((category) => ({ id: category.id, name: category.name, groupName: group.name })),
        ),
    [groups.data],
  )
  const categoryNames = useMemo(() => {
    const names = new Map<number, string>()
    for (const group of groups.data?.items ?? []) {
      for (const category of group.categories) names.set(category.id, category.name)
    }
    return names
  }, [groups.data])

  return {
    accounts: accounts.data?.items ?? [],
    payees: payees.data?.items ?? [],
    categories,
    categoryNames,
    balances: balances.data?.items ?? [],
    prefillLastAmount: settings.data?.prefill_last_amount ?? false,
    loading: accounts.isPending || payees.isPending || groups.isPending,
  }
}

export function useLedgerQuery(accountId: number | null, filters: LedgerFilters) {
  return useInfiniteQuery({
    queryKey: queryKeys.ledger(accountId, filters),
    queryFn: ({ pageParam, signal }) => fetchLedger(accountId, filters, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  })
}

// ---------------------------------------------------------------------------- mutations

type Snapshot = { ledger: LedgerData | undefined; balances: { items: Balance[] } | undefined }

let nextTempId = -1

function tempId(): number {
  return nextTempId--
}

type View = { accountId: number | null; filters: LedgerFilters; account: Account | undefined }

/** The shared plumbing every ledger mutation uses: snapshot, local edit, server reconcile. */
function ledgerCacheOps(queryClient: QueryClient, view: View) {
  const key = queryKeys.ledger(view.accountId, view.filters)
  const filtered = hasActiveFilters(view.filters)
  const running = view.accountId !== null && !filtered && view.account?.valuation_mode !== 'manual'

  const belongs = (row: Transaction) => view.accountId === null || row.account_id === view.accountId

  function recompute(data: LedgerData): LedgerData {
    if (!running) return data
    const balance = queryClient
      .getQueryData<{ items: Balance[] }>(queryKeys.balances)
      ?.items.find((item) => item.account_id === view.accountId)
    return balance === undefined ? data : withRunningBalances(data, balance.current_cents)
  }

  function editLedger(edit: (data: LedgerData) => LedgerData) {
    queryClient.setQueryData<LedgerData>(key, (data) => (data ? recompute(edit(data)) : data))
  }

  function editBalances(edit: (items: Balance[]) => Balance[]) {
    queryClient.setQueryData<{ items: Balance[] }>(queryKeys.balances, (data) =>
      data ? { items: edit(data.items) } : data,
    )
  }

  return {
    key,
    belongs,

    async begin(): Promise<Snapshot> {
      await queryClient.cancelQueries({ queryKey: key })
      await queryClient.cancelQueries({ queryKey: queryKeys.balances })
      return {
        ledger: queryClient.getQueryData<LedgerData>(key),
        balances: queryClient.getQueryData<{ items: Balance[] }>(queryKeys.balances),
      }
    },

    restore(snapshot: Snapshot | undefined) {
      if (snapshot === undefined) return
      queryClient.setQueryData(key, snapshot.ledger)
      queryClient.setQueryData(queryKeys.balances, snapshot.balances)
    },

    /** Balances first, so the running balances are worked out from the new totals. */
    local(
      balanceEdit: (items: Balance[]) => Balance[],
      ledgerEdit: (data: LedgerData) => LedgerData,
    ) {
      editBalances(balanceEdit)
      editLedger(ledgerEdit)
    },

    /** Takes the server's rows and balances, dropping any temporary rows they replace. */
    settle(result: MutationResult, replaced: number[] = []) {
      editBalances((items) => applyBalances(items, result.balances))
      editLedger((data) =>
        upsertRows(
          removeRows(data, [...replaced, ...result.deleted_ids]),
          result.transactions.filter(belongs),
        ),
      )
      // Other ledger views (another account, All accounts, a different filter) are now
      // out of date. They refetch when next shown; this one is already right, unless a
      // server-side filter decides what belongs in it.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.transactions,
        predicate: (query) => filtered || JSON.stringify(query.queryKey) !== JSON.stringify(key),
      })
      // Budget actuals and the dashboard read the same transactions.
      void queryClient.invalidateQueries({ queryKey: queryKeys.budgets })
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
      // A payment can pay (or, deleted, reopen) a bill.
      void queryClient.invalidateQueries({ queryKey: queryKeys.bills })
      void queryClient.invalidateQueries({ queryKey: queryKeys.subscriptions })
    },

    rows(): Transaction[] {
      return flatRows(queryClient.getQueryData<LedgerData>(key)).map((row) => row.transaction)
    },

    find(id: number): Transaction | undefined {
      return findRow(queryClient.getQueryData<LedgerData>(key), id)?.transaction
    },
  }
}

/** Just enough of a transaction for rememberPayee, from what is about to be saved. */
function draftTransaction(body: TransactionInput): Transaction {
  return {
    payee_id: body.payee_id ?? null,
    date: body.date,
    amount_cents: body.amount_cents,
    splits: (body.splits ?? []).map((split, index) => ({
      id: 0,
      category_id: split.category_id ?? null,
      amount_cents: split.amount_cents,
      memo: split.memo ?? null,
      sort_order: index,
    })),
  } as Transaction
}

function rememberPayee(queryClient: QueryClient, payee: Payee | null, transaction: Transaction) {
  queryClient.setQueryData<{ items: Payee[] }>(payeeListKey, (data) => {
    if (!data) return data
    const id = payee?.id ?? transaction.payee_id
    if (id === null) return data
    const single = transaction.splits.length === 1 ? transaction.splits[0].category_id : null
    const known = data.items.some((row) => row.id === id)
    const items = known ? data.items : [...data.items, payee as Payee]
    return {
      items: items
        .map((row) =>
          row.id === id
            ? {
                ...row,
                last_category_id: single,
                last_amount_cents: transaction.amount_cents,
                last_used: transaction.date,
              }
            : row,
        )
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())),
    }
  })
  // The Payees page's usage columns catch up when it is next opened.
  void queryClient.invalidateQueries({ queryKey: queryKeys.payees, refetchType: 'none' })
}

/** Finds the payee a 409 says already exists, e.g. created by someone else a moment ago. */
async function findOrCreatePayee(name: string): Promise<Payee> {
  try {
    return await createPayee({ name })
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 409) {
      const found = (await fetchPayees(name)).items.find(
        (row) => row.name.toLowerCase() === name.toLowerCase(),
      )
      if (found) return found
    }
    throw error
  }
}

type CreateResult = { result: MutationResult; payee: Payee | null }

export type UpdateVars = {
  id: number
  body: Partial<TransactionInput> & { status?: TransactionStatus }
  confirm?: boolean
  /** A payee typed during an inline edit that does not exist yet. */
  newPayeeName?: string | null
}

/** Optimistic temporary rows for a plan, one per leg. */
function optimisticRows(plan: SavePlan, payees: Payee[]): Transaction[] {
  const base = {
    check_number: null,
    status: 'uncleared' as TransactionStatus,
    memo: plan.body.memo ?? null,
    date: plan.body.date,
  }
  if (plan.kind === 'transfer') {
    const { from_account_id: from, to_account_id: to, amount_cents: amount } = plan.body
    const split = (value: number) =>
      plan.body.category_id != null
        ? [
            {
              id: 0,
              category_id: plan.body.category_id,
              amount_cents: value,
              memo: null,
              sort_order: 0,
            },
          ]
        : []
    return [
      {
        ...base,
        id: tempId(),
        account_id: from,
        payee_id: null,
        amount_cents: -amount,
        transfer_id: 'pending',
        transfer_account_id: to,
        splits: split(-amount),
      },
      {
        ...base,
        id: tempId(),
        account_id: to,
        payee_id: null,
        amount_cents: amount,
        transfer_id: 'pending',
        transfer_account_id: from,
        splits: split(amount),
      },
    ]
  }
  const body = plan.body
  return [
    {
      ...base,
      id: tempId(),
      account_id: body.account_id,
      payee_id: body.payee_id ?? null,
      pending_payee_name:
        plan.newPayeeName ?? payees.find((row) => row.id === body.payee_id)?.name ?? undefined,
      amount_cents: body.amount_cents,
      transfer_id: null,
      transfer_account_id: null,
      splits: (body.splits ?? []).map((split, index) => ({
        id: 0,
        category_id: split.category_id,
        amount_cents: split.amount_cents,
        memo: split.memo ?? null,
        sort_order: index,
      })),
    },
  ]
}

export function useLedgerMutations(view: View, payees: Payee[]) {
  const queryClient = useQueryClient()
  const ops = ledgerCacheOps(queryClient, view)

  const create = useMutation({
    mutationFn: async (plan: SavePlan): Promise<CreateResult> => {
      if (plan.kind === 'transfer') {
        return { result: await createTransfer(plan.body), payee: null }
      }
      let payee: Payee | null = null
      const body: TransactionInput = { ...plan.body }
      if (plan.newPayeeName) {
        payee = await findOrCreatePayee(plan.newPayeeName)
        body.payee_id = payee.id
        // Teach the typeahead now, not after the save: the next entry may already be typed.
        rememberPayee(queryClient, payee, draftTransaction(body))
      }
      return { result: await createTransaction(body), payee }
    },
    onMutate: async (plan) => {
      const snapshot = await ops.begin()
      const rows = optimisticRows(plan, payees)
      if (plan.kind === 'transaction' && plan.body.payee_id && rows[0]) {
        rememberPayee(queryClient, null, rows[0])
      }
      ops.local(
        (items) =>
          rows.reduce(
            (acc, row) => shiftBalance(acc, row.account_id, row.amount_cents, row.status),
            items,
          ),
        (data) => upsertRows(data, rows.filter(ops.belongs)),
      )
      return { snapshot, tempIds: rows.map((row) => row.id) }
    },
    onError: (_error, _plan, context) => ops.restore(context?.snapshot),
    onSuccess: ({ result, payee }, plan, context) => {
      ops.settle(result, context?.tempIds)
      if (plan.kind === 'transaction' && result.transactions[0]) {
        rememberPayee(queryClient, payee, result.transactions[0])
      }
    },
  })

  const update = useMutation({
    mutationFn: async ({ id, body, confirm, newPayeeName }: UpdateVars): Promise<CreateResult> => {
      let payee: Payee | null = null
      if (newPayeeName) {
        payee = await findOrCreatePayee(newPayeeName)
        body = { ...body, payee_id: payee.id }
      }
      return { result: await updateTransaction(id, body, confirm), payee }
    },
    onMutate: async ({ id, body, newPayeeName }) => {
      const snapshot = await ops.begin()
      const before = ops.find(id)
      if (before !== undefined) {
        const after: Transaction = {
          ...before,
          ...body,
          payee_id: body.payee_id !== undefined ? body.payee_id : before.payee_id,
          pending_payee_name: newPayeeName ?? undefined,
          memo: body.memo !== undefined ? body.memo : before.memo,
          splits: body.splits
            ? body.splits.map((split, index) => ({
                id: 0,
                category_id: split.category_id,
                amount_cents: split.amount_cents,
                memo: split.memo ?? null,
                sort_order: index,
              }))
            : before.splits,
        }
        ops.local(
          (items) => {
            // Take the old row out of its account's balances, then put the new one in.
            let next = shiftBalance(items, before.account_id, -before.amount_cents, before.status)
            next = shiftBalance(next, after.account_id, after.amount_cents, after.status)
            if (before.transfer_account_id !== null) {
              // The partner leg mirrors this one.
              next = shiftBalance(
                next,
                before.transfer_account_id,
                before.amount_cents,
                before.status,
              )
              next = shiftBalance(
                next,
                before.transfer_account_id,
                -after.amount_cents,
                after.status,
              )
            }
            return next
          },
          (data) => upsertRows(removeRows(data, [id]), ops.belongs(after) ? [after] : []),
        )
      }
      return { snapshot }
    },
    onError: (_error, _vars, context) => ops.restore(context?.snapshot),
    onSuccess: ({ result, payee }) => {
      ops.settle(result)
      const row = result.transactions[0]
      if (row && row.payee_id !== null && row.transfer_id === null)
        rememberPayee(queryClient, payee, row)
    },
  })

  const remove = useMutation({
    mutationFn: ({ row, confirm }: { row: Transaction; confirm?: boolean }) =>
      deleteTransaction(row.id, confirm),
    onMutate: async ({ row }) => {
      const snapshot = await ops.begin()
      const legs = ops
        .rows()
        .filter(
          (other) =>
            other.id === row.id ||
            (row.transfer_id !== null && other.transfer_id === row.transfer_id),
        )
      ops.local(
        (items) => {
          let next = shiftBalance(items, row.account_id, -row.amount_cents, row.status)
          if (row.transfer_account_id !== null) {
            next = shiftBalance(next, row.transfer_account_id, row.amount_cents, row.status)
          }
          return next
        },
        (data) =>
          removeRows(
            data,
            legs.map((leg) => leg.id),
          ),
      )
      return { snapshot }
    },
    onError: (_error, _vars, context) => ops.restore(context?.snapshot),
    onSuccess: (result) => ops.settle(result),
  })

  return { create, update, remove, find: ops.find, rows: ops.rows }
}

export function isReconciledConfirm(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === 'reconciled_edit_requires_confirm'
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.detail
  return 'Something went wrong saving that. Nothing was changed.'
}
