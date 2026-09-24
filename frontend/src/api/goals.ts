import { apiFetch } from './client'

/** Savings goals and sinking funds (SPEC §13). Money is integer cents. */

export type GoalType = 'savings' | 'sinking_fund'
export type GoalStatus = 'done' | 'on_track' | 'behind' | 'no_target'

export type GoalInput = {
  name: string
  type: GoalType
  target_cents: number
  target_date: string | null
  account_id: number | null
  category_id: number | null
  starting_balance_cents: number
  start_date: string | null
  notes: string | null
}

export type Goal = Omit<GoalInput, 'start_date'> & {
  id: number
  start_date: string
  is_archived: boolean
  progress_cents: number
  remaining_cents: number
  needed_cents: number | null
  periods_left: number | null
  current_planned_cents: number | null
  rate_cents: number
  projected_date: string | null
  status: GoalStatus
  current_period_id: number | null
}

export function fetchGoals(archived = false, signal?: AbortSignal): Promise<{ items: Goal[] }> {
  return apiFetch(`/goals${archived ? '?archived=true' : ''}`, { signal })
}

export function createGoal(body: GoalInput): Promise<Goal> {
  return apiFetch('/goals', { method: 'POST', body })
}

export function updateGoal(
  id: number,
  body: Partial<GoalInput> & { is_archived?: boolean },
): Promise<Goal> {
  return apiFetch(`/goals/${id}`, { method: 'PATCH', body })
}

export function deleteGoal(id: number): Promise<void> {
  return apiFetch(`/goals/${id}`, { method: 'DELETE' })
}

export function applySuggestedContribution(id: number): Promise<Goal> {
  return apiFetch(`/goals/${id}/use-suggested`, { method: 'POST' })
}
