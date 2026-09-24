import { describe, expect, it } from 'vitest'

import type { BudgetView, PlanLine } from '../../api/budget'
import { plannedAmounts, progress, summarize, withPlanned } from './budgetMath'

function line(id: number, kind: PlanLine['kind'], planned: number, actual: number): PlanLine {
  return {
    category_id: id,
    name: `c${id}`,
    kind,
    planned_cents: planned,
    actual_cents: actual,
    remaining_cents: planned - actual,
    overspent: kind === 'expense' && actual > planned,
    is_sinking_fund: false,
    is_hidden: false,
    note: null,
  }
}

const view: BudgetView = {
  period: {
    id: 1,
    start_date: '2026-01-02',
    end_date: '2026-01-15',
    schedule_id: 1,
    is_transition: false,
    days: 14,
  },
  previous_id: null,
  next_id: 2,
  income: [
    {
      id: 10,
      name: 'Income',
      kind: 'income',
      planned_cents: 300_000,
      actual_cents: 150_000,
      remaining_cents: 150_000,
      lines: [line(1, 'income', 300_000, 150_000)],
    },
  ],
  expense: [
    {
      id: 20,
      name: 'Food',
      kind: 'expense',
      planned_cents: 50_000,
      actual_cents: 45_000,
      remaining_cents: 5_000,
      lines: [line(2, 'expense', 40_000, 40_000), line(3, 'expense', 10_000, 5_000)],
    },
    {
      id: 30,
      name: 'Home',
      kind: 'expense',
      planned_cents: 100_000,
      actual_cents: 0,
      remaining_cents: 100_000,
      lines: [line(4, 'expense', 100_000, 0)],
    },
  ],
  summary: {
    expected_income_cents: 300_000,
    received_income_cents: 150_000,
    planned_expense_cents: 150_000,
    left_to_plan_cents: 150_000,
    spent_cents: 45_000,
    remaining_cents: 105_000,
  },
  uncategorized_count: 0,
}

describe('summarize', () => {
  it('matches the server summary for the same lines', () => {
    expect(summarize([...view.income, ...view.expense])).toEqual(view.summary)
  })
})

describe('withPlanned', () => {
  it('updates the line, its group and the summary at once', () => {
    const next = withPlanned(view, new Map([[3, 2_000]]))
    const food = next.expense[0]
    expect(food.lines[1]).toMatchObject({
      planned_cents: 2_000,
      remaining_cents: -3_000,
      overspent: true,
    })
    expect(food).toMatchObject({
      planned_cents: 42_000,
      actual_cents: 45_000,
      remaining_cents: -3_000,
    })
    expect(next.summary).toMatchObject({
      planned_expense_cents: 142_000,
      left_to_plan_cents: 158_000,
      remaining_cents: 97_000,
    })
    expect(next.expense[1]).toBe(view.expense[1]) // untouched groups are reused
  })

  it('treats income as never overspent', () => {
    const next = withPlanned(view, new Map([[1, 100_000]]))
    expect(next.income[0].lines[0]).toMatchObject({ remaining_cents: -50_000, overspent: false })
    expect(next.summary.expected_income_cents).toBe(100_000)
    expect(next.summary.left_to_plan_cents).toBe(-50_000)
  })
})

describe('plannedAmounts', () => {
  it('lists every category, for undo', () => {
    expect(plannedAmounts(view)).toEqual([
      { category_id: 1, planned_cents: 300_000 },
      { category_id: 2, planned_cents: 40_000 },
      { category_id: 3, planned_cents: 10_000 },
      { category_id: 4, planned_cents: 100_000 },
    ])
  })
})

describe('progress', () => {
  it('is the share of the plan used, capped to the bar', () => {
    expect(progress(10_000, 2_500)).toBe(0.25)
    expect(progress(10_000, 20_000)).toBe(1)
    expect(progress(10_000, -500)).toBe(0)
    expect(progress(0, 1)).toBe(1)
    expect(progress(0, 0)).toBe(0)
  })
})
