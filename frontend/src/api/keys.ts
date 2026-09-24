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
  subscriptions: ['subscriptions'] as const,
  notifications: ['notifications'] as const,
  rules: ['rules'] as const,
  reconcile: ['reconcile'] as const,
  reports: ['reports'] as const,
  goals: ['goals'] as const,
  netWorth: (range: string) => ['net-worth', range] as const,
  netWorthAll: ['net-worth'] as const,
  debtPlan: ['debt-plan'] as const,
  debtSimulation: (extra: number | null, strategy: string | null, order: number[]) =>
    ['debt-plan', 'simulation', extra, strategy, order] as const,
  goalList: (archived: boolean) => ['goals', { archived }] as const,
  report: (name: string, query: string) => ['reports', name, query] as const,
  worksheet: (accountId: number, statementDate: string) =>
    ['reconcile', 'worksheet', accountId, statementDate] as const,
  reconciliations: (accountId: number) => ['reconcile', 'history', accountId] as const,
  importProfiles: ['import-profiles'] as const,
  imports: ['imports'] as const,
  importHistory: (accountId: number) => ['imports', 'history', accountId] as const,
  importBatch: (batchId: number) => ['imports', 'batch', batchId] as const,
  bills: ['bills'] as const,
  billRange: (from: string, to: string) => ['bills', from, to] as const,
  bill: (occurrenceId: number) => ['bills', 'one', occurrenceId] as const,
  ledger: (accountId: number | null, filters: LedgerFilters) =>
    ['transactions', { accountId, filters }] as const,
}
