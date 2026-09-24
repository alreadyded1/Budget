import { apiFetch } from './client'

/** Net worth and the debt payoff planner (SPEC §14). Money is integer cents. */

export type Point = {
  date: string
  assets_cents: number
  /** Signed: liabilities are negative. */
  liabilities_cents: number
  net_cents: number
}

export type NetWorth = {
  today: Point
  history: Point[]
  breakdown: {
    type: string
    label: string
    is_liability: boolean
    balance_cents: number
    accounts: { account_id: number; name: string; balance_cents: number }[]
  }[]
}

export function fetchNetWorth(range: string, signal?: AbortSignal): Promise<NetWorth> {
  const query = range === 'all' ? 'all=true' : `months=${range}`
  return apiFetch(`/net-worth?${query}`, { signal })
}

export type Strategy = 'snowball' | 'avalanche' | 'custom'

export type DebtRow = {
  account_id: number
  name: string
  owed_cents: number
  apr_bps: number | null
  min_payment_cents: number | null
}

export type DebtPlan = {
  strategy: Strategy
  extra_monthly_cents: number
  custom_order: number[]
  debts: DebtRow[]
  skipped: (DebtRow & { reason: string })[]
}

export type StrategyResult = {
  strategy: Strategy
  order: number[]
  months: number
  finished: boolean
  debt_free: string | null
  total_interest_cents: number
  total_paid_cents: number
  payoffs: { account_id: number; month_index: number | null; month: string | null }[]
}

export type Simulation = {
  extra_monthly_cents: number
  strategies: StrategyResult[]
  schedule_strategy: Strategy | null
  schedule: {
    index: number
    month: string
    lines: {
      account_id: number
      interest_cents: number
      payment_cents: number
      balance_cents: number
    }[]
  }[]
}

export function fetchDebtPlan(signal?: AbortSignal): Promise<DebtPlan> {
  return apiFetch('/debt-plan', { signal })
}

export function saveDebtPlan(
  body: Partial<Pick<DebtPlan, 'strategy' | 'extra_monthly_cents' | 'custom_order'>>,
): Promise<DebtPlan> {
  return apiFetch('/debt-plan', { method: 'PUT', body })
}

export function fetchSimulation(
  extraCents: number | null,
  strategy: Strategy | null,
  order: number[] = [],
  signal?: AbortSignal,
): Promise<Simulation> {
  const params = new URLSearchParams()
  if (extraCents !== null) params.set('extra_cents', String(extraCents))
  if (strategy) params.set('strategy', strategy)
  for (const id of order) params.append('order', String(id))
  const query = params.toString()
  return apiFetch(`/debt-plan/simulation${query ? `?${query}` : ''}`, { signal })
}
