import { apiFetch } from './client'
import type { Transaction } from './transactions'

/** Reports (SPEC §16). Money is integer cents; shares are basis points (1% = 100). */

export const PRESETS = [
  { key: 'this_period', label: 'This pay period' },
  { key: 'last_period', label: 'Last pay period' },
  { key: 'month_to_date', label: 'Month to date' },
  { key: 'last_month', label: 'Last month' },
  { key: 'year_to_date', label: 'Year to date' },
  { key: 'last_year', label: 'Last year' },
  { key: 'custom', label: 'Custom range' },
] as const
export type Preset = (typeof PRESETS)[number]['key']

export type ReportQuery = {
  preset: Preset
  from?: string
  to?: string
  accountIds: number[]
  categoryIds: number[]
  payeeIds: number[]
  uncategorized?: boolean
}

/** The query string every report endpoint takes. */
export function reportParams(query: ReportQuery, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams()
  if (query.preset === 'custom') {
    if (query.from) params.set('from', query.from)
    if (query.to) params.set('to', query.to)
  } else {
    params.set('preset', query.preset)
  }
  for (const id of query.accountIds) params.append('account_id', String(id))
  for (const id of query.categoryIds) params.append('category_id', String(id))
  for (const id of query.payeeIds) params.append('payee_id', String(id))
  if (query.uncategorized) params.set('uncategorized', 'true')
  for (const [key, value] of Object.entries(extra)) params.set(key, value)
  return params.toString()
}

type Range = { start: string; end: string }

export type CategoryTotal = {
  category_id: number | null
  name: string
  group_id: number | null
  group_name: string
  total_cents: number
  share_bp: number
  count: number
}
export type SpendingByCategory = Range & { items: CategoryTotal[]; total_cents: number }

export type PayeeTotal = {
  payee_id: number | null
  name: string
  total_cents: number
  share_bp: number
  count: number
}
export type SpendingByPayee = Range & { items: PayeeTotal[]; total_cents: number }

export type Flow = {
  income_cents: number
  spending_cents: number
  net_cents: number
  savings_rate_bp: number | null
}
export type Bucket = Flow & Range & { label: string }
export type IncomeVsExpense = Range & { by: 'month' | 'period'; buckets: Bucket[]; total: Flow }

export type PeriodPlan = {
  period_id: number
  start: string
  end: string
  is_transition: boolean
  planned_expense_cents: number
  actual_expense_cents: number
  planned_income_cents: number
  actual_income_cents: number
}
export type CategoryPlan = {
  category_id: number
  name: string
  group_name: string
  kind: 'income' | 'expense'
  planned_cents: number
  actual_cents: number
  variance_cents: number
}
export type PlannedVsActual = Range & { periods: PeriodPlan[]; categories: CategoryPlan[] }

export type CategoryTrend = Range & {
  months: Range[]
  series: { category_id: number; name: string; values: number[] }[]
}

export type SubscriptionCosts = {
  items: {
    category_id: number | null
    name: string
    monthly_cents: number
    annual_cents: number
    count: number
  }[]
  monthly_cents: number
  annual_cents: number
}

export type TransactionList = Range & {
  items: { transaction: Transaction; amount_cents: number; running_cents: number }[]
  total_cents: number
  truncated: boolean
}

function get<T>(path: string, query: string, signal?: AbortSignal): Promise<T> {
  return apiFetch<T>(`/reports/${path}${query ? `?${query}` : ''}`, { signal })
}

export const reportsApi = {
  range: (q: string, s?: AbortSignal) => get<Range>('range', q, s),
  spendingByCategory: (q: string, s?: AbortSignal) =>
    get<SpendingByCategory>('spending-by-category', q, s),
  spendingByPayee: (q: string, s?: AbortSignal) => get<SpendingByPayee>('spending-by-payee', q, s),
  incomeVsExpense: (q: string, s?: AbortSignal) => get<IncomeVsExpense>('income-vs-expense', q, s),
  plannedVsActual: (q: string, s?: AbortSignal) => get<PlannedVsActual>('planned-vs-actual', q, s),
  categoryTrend: (q: string, s?: AbortSignal) => get<CategoryTrend>('category-trend', q, s),
  subscriptions: (s?: AbortSignal) => get<SubscriptionCosts>('subscriptions', '', s),
  transactions: (q: string, s?: AbortSignal) => get<TransactionList>('transactions', q, s),
}
