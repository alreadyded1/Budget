import type { Goal, GoalInput, GoalType } from '../../api/goals'
import { evaluateAmount } from '../../lib/amountExpr'
import { isValidIsoDate } from '../../lib/dates'
import { centsToInput } from '../ledger/draft'

/** The goal form's text state and how it turns into the API body. */

export type GoalFormState = {
  type: GoalType
  name: string
  target: string
  targetDate: string
  accountId: number | null
  categoryId: number | null
  categoryText: string
  starting: string
  startDate: string
  notes: string
}

function signed(cents: number): string {
  return `${cents < 0 ? '-' : ''}${centsToInput(cents)}`
}

export function emptyForm(type: GoalType, today: string): GoalFormState {
  return {
    type,
    name: '',
    target: '',
    targetDate: '',
    accountId: null,
    categoryId: null,
    categoryText: '',
    starting: '',
    startDate: today,
    notes: '',
  }
}

export function formFromGoal(goal: Goal, categoryName: string): GoalFormState {
  return {
    type: goal.type,
    name: goal.name,
    target: centsToInput(goal.target_cents),
    targetDate: goal.target_date ?? '',
    accountId: goal.account_id,
    categoryId: goal.category_id,
    categoryText: goal.category_id === null ? '' : categoryName,
    starting: goal.starting_balance_cents ? signed(goal.starting_balance_cents) : '',
    startDate: goal.start_date,
    notes: goal.notes ?? '',
  }
}

/** The body to send, or the first problem to show. */
export function buildGoal(form: GoalFormState): GoalInput | string {
  if (!form.name.trim()) return 'Give the goal a name.'
  const target = evaluateAmount(form.target)
  if (target === null || target <= 0) return 'Type a target amount above zero.'
  const starting = form.starting.trim() ? evaluateAmount(form.starting) : 0
  if (starting === null) return 'The starting amount is not a number.'
  if (form.targetDate && !isValidIsoDate(form.targetDate)) return 'The target date is not a date.'
  if (form.startDate && !isValidIsoDate(form.startDate)) return 'The start date is not a date.'
  if (form.categoryText.trim() && form.categoryId === null)
    return 'Pick a category from the list, or clear the field.'
  if (form.type === 'sinking_fund' && form.categoryId === null)
    return 'A sinking fund needs its category.'
  if (form.type === 'savings' && form.accountId === null) return 'Pick the savings account.'
  return {
    name: form.name.trim(),
    type: form.type,
    target_cents: target,
    target_date: form.targetDate || null,
    account_id: form.type === 'savings' ? form.accountId : null,
    category_id: form.categoryId,
    starting_balance_cents: starting,
    start_date: form.startDate || null,
    notes: form.notes.trim() || null,
  }
}
