import { apiFetch } from './client'

export type TransactionStatus = 'uncleared' | 'cleared' | 'reconciled'

export type Split = {
  id: number
  category_id: number | null
  amount_cents: number
  memo: string | null
  sort_order: number
}

export type Transaction = {
  id: number
  account_id: number
  date: string
  payee_id: number | null
  memo: string | null
  amount_cents: number
  status: TransactionStatus
  check_number: string | null
  transfer_id: string | null
  transfer_account_id: number | null
  splits: Split[]
  /** Receipts attached to it (SPEC §15). */
  attachment_count?: number
  /** Client-only: the name typed for a payee that is still being created. */
  pending_payee_name?: string
}

export type LedgerRow = {
  transaction: Transaction
  running_balance_cents: number | null
}

export type LedgerPage = {
  items: LedgerRow[]
  next_cursor: string | null
  total_cents: number
}

export type Balance = {
  account_id: number
  current_cents: number
  cleared_cents: number
  reconciled_cents: number
}

export type BillMatch = {
  occurrence_id: number
  name: string
  due_date: string
  amount_cents: number
}

export type MutationResult = {
  transactions: Transaction[]
  deleted_ids: number[]
  balances: Balance[]
  /** On a create: an unpaid bill this looks like the payment for. */
  bill_match?: BillMatch | null
  /** On a create: the bill it was asked to mark paid. */
  paid_occurrence_id?: number | null
}

export type SplitInput = {
  amount_cents: number
  category_id: number | null
  memo?: string | null
}

export type TransactionInput = {
  account_id: number
  date: string
  amount_cents: number
  payee_id?: number | null
  memo?: string | null
  status?: TransactionStatus
  splits?: SplitInput[] | null
  /** Marks this bill paid by the new transaction ("Mark paid"). */
  subscription_occurrence_id?: number | null
}

export type TransferInput = {
  from_account_id: number
  to_account_id: number
  date: string
  amount_cents: number
  category_id?: number | null
  memo?: string | null
  status?: TransactionStatus
}

export type LedgerFilters = {
  text?: string
  from?: string
  to?: string
  categoryId?: number
  payeeId?: number
  status?: TransactionStatus
  minCents?: number
  maxCents?: number
  /** Only transactions with an uncategorized split (the budget's alert link). */
  uncategorized?: boolean
  /** Only on-budget (true) or tracking (false) accounts. */
  onBudget?: boolean
}

export const PAGE_SIZE = 200

export function hasActiveFilters(filters: LedgerFilters): boolean {
  return Object.values(filters).some((value) => value !== undefined && value !== '')
}

export function fetchLedger(
  accountId: number | null,
  filters: LedgerFilters,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<LedgerPage> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
  if (accountId !== null) params.set('account_id', String(accountId))
  if (cursor) params.set('cursor', cursor)
  if (filters.text?.trim()) params.set('text', filters.text.trim())
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.categoryId !== undefined) params.set('category_id', String(filters.categoryId))
  if (filters.payeeId !== undefined) params.set('payee_id', String(filters.payeeId))
  if (filters.status) params.set('status', filters.status)
  if (filters.minCents !== undefined) params.set('min_cents', String(filters.minCents))
  if (filters.maxCents !== undefined) params.set('max_cents', String(filters.maxCents))
  if (filters.uncategorized) params.set('uncategorized', 'true')
  if (filters.onBudget !== undefined) params.set('on_budget', String(filters.onBudget))
  return apiFetch(`/transactions?${params.toString()}`, { signal })
}

export function fetchBalances(signal?: AbortSignal): Promise<{ items: Balance[] }> {
  return apiFetch('/balances', { signal })
}

export function createTransaction(body: TransactionInput): Promise<MutationResult> {
  return apiFetch('/transactions', { method: 'POST', body })
}

export function createTransfer(body: TransferInput): Promise<MutationResult> {
  return apiFetch('/transfers', { method: 'POST', body })
}

export function updateTransaction(
  id: number,
  body: Partial<TransactionInput>,
  confirm = false,
): Promise<MutationResult> {
  return apiFetch(`/transactions/${id}${confirm ? '?confirm=true' : ''}`, {
    method: 'PATCH',
    body,
  })
}

export function deleteTransaction(id: number, confirm = false): Promise<MutationResult> {
  return apiFetch(`/transactions/${id}${confirm ? '?confirm=true' : ''}`, { method: 'DELETE' })
}
