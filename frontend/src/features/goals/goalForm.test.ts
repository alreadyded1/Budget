import { describe, expect, it } from 'vitest'

import { buildGoal, emptyForm } from './goalForm'

describe('buildGoal', () => {
  const base = { ...emptyForm('sinking_fund', '2026-09-24'), name: 'Car insurance', target: '600' }

  it('builds a sinking fund in cents', () => {
    expect(
      buildGoal({ ...base, categoryId: 4, categoryText: 'Car insurance', starting: '100.50' }),
    ).toEqual({
      name: 'Car insurance',
      type: 'sinking_fund',
      target_cents: 60000,
      target_date: null,
      account_id: null,
      category_id: 4,
      starting_balance_cents: 10050,
      start_date: '2026-09-24',
      notes: null,
    })
  })

  it('says what is missing', () => {
    expect(buildGoal({ ...base, name: ' ' })).toMatch(/name/)
    expect(buildGoal({ ...base, target: '0' })).toMatch(/above zero/)
    expect(buildGoal(base)).toMatch(/needs its category/)
    expect(buildGoal({ ...base, categoryText: 'Car' })).toMatch(/Pick a category/)
    expect(buildGoal({ ...base, type: 'savings' })).toMatch(/savings account/)
  })

  it('a savings goal keeps its account and an optional plan category', () => {
    const body = buildGoal({ ...base, type: 'savings', accountId: 3, targetDate: '2027-06-30' })
    expect(body).toMatchObject({ account_id: 3, category_id: null, target_date: '2027-06-30' })
  })
})
