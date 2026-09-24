import type { Transaction } from '../../api/transactions'

/** Mirrors app/domain/reconcile.py. Every amount is integer cents in the account's sign. */

/** What the user typed, as the statement prints it (a card's amount owed is positive). */
export function statementCents(typedCents: number, isLiability: boolean): number {
  return isLiability ? -typedCents : typedCents
}

/** A stored statement balance as the statement printed it. */
export function typedCents(balanceCents: number, isLiability: boolean): number {
  return isLiability ? -balanceCents : balanceCents
}

export function tickedCents(rows: Transaction[]): number {
  return rows.reduce((sum, row) => (row.status === 'cleared' ? sum + row.amount_cents : sum), 0)
}

/** Statement minus (reconciled balance + ticked rows). Zero means Finish is allowed; otherwise
 * it is the adjustment, in the account's sign, that would close the gap. */
export function difference(statement: number, reconciledCents: number, rows: Transaction[]) {
  return statement - (reconciledCents + tickedCents(rows))
}
