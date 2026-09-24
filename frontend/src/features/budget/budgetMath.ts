/** The planner's local math, so an edited planned amount updates Remaining and the
 * summary before the server answers. Mirrors app/domain/budget.py (D-054).
 */

import type { BudgetSummary, BudgetView, PlanGroup, PlanKind } from '../../api/budget'

export function isOverspent(kind: PlanKind, planned: number, actual: number): boolean {
  return kind === 'expense' && actual > planned
}

export function summarize(groups: PlanGroup[]): BudgetSummary {
  let expected = 0
  let received = 0
  let planned = 0
  let spent = 0
  for (const group of groups) {
    for (const line of group.lines) {
      if (line.kind === 'income') {
        expected += line.planned_cents
        received += line.actual_cents
      } else {
        planned += line.planned_cents
        spent += line.actual_cents
      }
    }
  }
  return {
    expected_income_cents: expected,
    received_income_cents: received,
    planned_expense_cents: planned,
    left_to_plan_cents: expected - planned,
    spent_cents: spent,
    remaining_cents: planned - spent,
  }
}

function regroup(group: PlanGroup): PlanGroup {
  const planned = group.lines.reduce((sum, line) => sum + line.planned_cents, 0)
  const actual = group.lines.reduce((sum, line) => sum + line.actual_cents, 0)
  return {
    ...group,
    planned_cents: planned,
    actual_cents: actual,
    remaining_cents: planned - actual,
  }
}

/** The view with one or more categories' planned amounts replaced. */
export function withPlanned(view: BudgetView, amounts: Map<number, number>): BudgetView {
  const update = (group: PlanGroup): PlanGroup => {
    if (!group.lines.some((line) => amounts.has(line.category_id))) return group
    return regroup({
      ...group,
      lines: group.lines.map((line) => {
        const planned = amounts.get(line.category_id)
        if (planned === undefined) return line
        const fund =
          line.fund_balance_cents === null || line.fund_balance_cents === undefined
            ? null
            : line.fund_balance_cents + planned - line.planned_cents
        return {
          ...line,
          planned_cents: planned,
          remaining_cents: planned - line.actual_cents,
          // A sinking fund is overspent only when its balance is below zero (D-089).
          overspent: fund === null ? isOverspent(line.kind, planned, line.actual_cents) : fund < 0,
          fund_balance_cents: fund,
        }
      }),
    })
  }
  const income = view.income.map(update)
  const expense = view.expense.map(update)
  return { ...view, income, expense, summary: summarize([...income, ...expense]) }
}

/** Every category's planned amount, for an Undo after a whole-plan action. */
export function plannedAmounts(view: BudgetView): { category_id: number; planned_cents: number }[] {
  return [...view.income, ...view.expense].flatMap((group) =>
    group.lines.map((line) => ({
      category_id: line.category_id,
      planned_cents: line.planned_cents,
    })),
  )
}

/** How far through its plan a line is, 0–1, for the progress bar. */
export function progress(planned: number, actual: number): number {
  if (planned <= 0) return actual > 0 ? 1 : 0
  return Math.max(0, Math.min(1, actual / planned))
}
