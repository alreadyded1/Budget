import type { AccountType } from '../../api/accounts'

/** Debts the payoff planner reads an APR and minimum payment for (SPEC §3, §14). */
export const DEBT_TYPES = new Set<AccountType>([
  'credit_card',
  'loan',
  'mortgage',
  'other_liability',
])

/** A debt whose balance comes from its transactions, so it is entered and shown as "owed". */
export function tracksOwed(type: AccountType, valuationMode: 'transactions' | 'manual'): boolean {
  return DEBT_TYPES.has(type) && valuationMode === 'transactions'
}

/** What was typed as "amount owed" → the stored balance. Owed money is negative (CLAUDE.md sign
 * convention), so the sign typed doesn't matter: `2450` and `-2450` are both $2,450 owed. */
export function owedToBalance(cents: number): number {
  return cents === 0 ? 0 : -Math.abs(cents)
}

/** A debt's stored balance → how it reads: an amount owed, or a credit when it's overpaid. */
export function describeOwed(balanceCents: number): { cents: number; label: 'owed' | 'in credit' } {
  return balanceCents > 0
    ? { cents: balanceCents, label: 'in credit' }
    : { cents: -balanceCents, label: 'owed' }
}
