import { apiFetch } from './client'
import type { Balance, Transaction } from './transactions'

/** Reconciliation (SPEC §12). Amounts are cents in the account's own sign. */

export type Reconciliation = {
  id: number
  account_id: number
  statement_date: string
  statement_balance_cents: number
  adjustment_transaction_id: number | null
  adjustment_cents: number | null
  transaction_count: number
  completed_by: number | null
  completed_at: string
}

export type Worksheet = {
  account_id: number
  is_liability: boolean
  statement_date: string
  reconciled_cents: number
  ticked_cents: number
  rows: Transaction[]
  last: Reconciliation | null
}

export type FinishInput = {
  statement_date: string
  statement_balance_cents: number
  adjust: boolean
  adjustment_category_id: number | null
}

export type ReconcileResult = { reconciliation: Reconciliation; balances: Balance[] }

export function fetchWorksheet(
  accountId: number,
  statementDate: string,
  signal?: AbortSignal,
): Promise<Worksheet> {
  return apiFetch(`/accounts/${accountId}/reconcile?statement_date=${statementDate}`, { signal })
}

export function finishReconciliation(
  accountId: number,
  body: FinishInput,
): Promise<ReconcileResult> {
  return apiFetch(`/accounts/${accountId}/reconciliations`, { method: 'POST', body })
}

export function fetchReconciliations(
  accountId: number,
  signal?: AbortSignal,
): Promise<{ items: Reconciliation[] }> {
  return apiFetch(`/accounts/${accountId}/reconciliations`, { signal })
}

export function undoReconciliation(id: number): Promise<ReconcileResult> {
  return apiFetch(`/reconciliations/${id}/undo`, { method: 'POST' })
}
