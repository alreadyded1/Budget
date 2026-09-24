import { apiFetch } from './client'
import type { Bill } from './subscriptions'
import type { Balance, Transaction } from './transactions'

export type PlanKind = 'expense' | 'income'

export type BudgetPeriod = {
  id: number
  start_date: string
  end_date: string
  schedule_id: number
  is_transition: boolean
  days: number
}

export type PlanLine = {
  category_id: number
  name: string
  kind: PlanKind
  planned_cents: number
  actual_cents: number
  remaining_cents: number
  overspent: boolean
  is_sinking_fund: boolean
  is_hidden: boolean
  note: string | null
  /** Bills due in the period for this category. */
  committed_cents: number
  /** A sinking fund's balance through this period (categories with a fund goal). */
  fund_balance_cents?: number | null
}

export type PlanGroup = {
  id: number
  name: string
  kind: PlanKind
  planned_cents: number
  actual_cents: number
  remaining_cents: number
  lines: PlanLine[]
}

export type BudgetSummary = {
  expected_income_cents: number
  received_income_cents: number
  planned_expense_cents: number
  left_to_plan_cents: number
  spent_cents: number
  remaining_cents: number
}

export type BudgetView = {
  period: BudgetPeriod
  previous_id: number | null
  next_id: number | null
  income: PlanGroup[]
  expense: PlanGroup[]
  summary: BudgetSummary
  uncategorized_count: number
}

export type BudgetAction = 'copy-previous' | 'apply-template' | 'clear' | 'prorate'

export type Overspent = {
  category_id: number
  name: string
  group_name: string
  planned_cents: number
  actual_cents: number
  over_cents: number
}

export type Dashboard = {
  today: string
  budget: BudgetView | null
  overspent: Overspent[]
  balances: Balance[]
  recent: Transaction[]
  upcoming_bills: Bill[]
}

export function fetchBudget(
  periodId: number | 'current',
  signal?: AbortSignal,
): Promise<BudgetView> {
  return apiFetch(`/budget/${periodId}`, { signal })
}

export function setPlanned(
  periodId: number,
  categoryId: number,
  plannedCents: number,
): Promise<BudgetView> {
  return apiFetch(`/budget/${periodId}/categories/${categoryId}`, {
    method: 'PUT',
    body: { planned_cents: plannedCents },
  })
}

export function setPlan(
  periodId: number,
  items: { category_id: number; planned_cents: number }[],
): Promise<BudgetView> {
  return apiFetch(`/budget/${periodId}/plan`, { method: 'PUT', body: { items } })
}

export function runBudgetAction(periodId: number, action: BudgetAction): Promise<BudgetView> {
  return apiFetch(`/budget/${periodId}/${action}`, { method: 'POST' })
}

export function fetchDashboard(signal?: AbortSignal): Promise<Dashboard> {
  return apiFetch('/dashboard', { signal })
}
