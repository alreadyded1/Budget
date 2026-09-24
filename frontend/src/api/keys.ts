import type { LedgerFilters } from './transactions'

/** Every TanStack Query key in one place so invalidation stays predictable. */

export const queryKeys = {
  health: ['health'] as const,
  session: ['session'] as const,
  users: ['users'] as const,
  settings: ['settings'] as const,
  paySchedule: ['pay-schedule'] as const,
  paySchedulePreview: ['pay-schedule', 'preview'] as const,
  payPeriods: ['pay-periods'] as const,
  currentPeriod: ['pay-periods', 'current'] as const,
  accounts: ['accounts'] as const,
  categoryGroups: ['category-groups'] as const,
  payees: ['payees'] as const,
  balances: ['balances'] as const,
  transactions: ['transactions'] as const,
  budgets: ['budget'] as const,
  budget: (periodId: number | 'current') => ['budget', periodId] as const,
  dashboard: ['dashboard'] as const,
  ledger: (accountId: number | null, filters: LedgerFilters) =>
    ['transactions', { accountId, filters }] as const,
}
