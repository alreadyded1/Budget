import { describe, expect, it } from 'vitest'

import type { Payee } from '../../api/payees'
import { buildForm, emptyForm } from './formState'

const payees = [{ id: 7, name: 'Netflix' } as Payee]
const categories = [{ id: 11, name: 'Streaming', groupName: 'Bills' }]

describe('buildForm', () => {
  const base = { ...emptyForm(), name: 'Netflix', amount: '15.99', anchor: '2026-10-01' }

  it('builds a monthly subscription from typed text', () => {
    const built = buildForm(
      { ...base, payeeText: 'netflix', categoryText: 'streaming', accountId: '2' },
      payees,
      categories,
    )
    expect(built).toEqual({
      ok: true,
      newPayeeName: null,
      body: expect.objectContaining({
        name: 'Netflix',
        payee_id: 7,
        category_id: 11,
        account_id: 2,
        amount_cents: 1599,
        frequency: 'monthly',
        interval_count: 1,
        interval_unit: null,
        anchor_date: '2026-10-01',
        end_date: null,
        remind_days_before: 3,
      }),
    })
  })

  it('keeps the interval only for a custom schedule', () => {
    const built = buildForm(
      { ...base, frequency: 'custom', intervalCount: '6', intervalUnit: 'week' },
      payees,
      categories,
    )
    expect(built.ok && built.body).toMatchObject({ interval_count: 6, interval_unit: 'week' })
  })

  it('creates an unknown payee on save', () => {
    const built = buildForm({ ...base, payeeText: 'Disney+' }, payees, categories)
    expect(built.ok && built.newPayeeName).toBe('Disney+')
  })

  it.each([
    [{ name: ' ' }, 'Give it a name.'],
    [{ amount: '0' }, 'Enter an amount above zero.'],
    [{ amount: 'abc' }, 'Enter an amount above zero.'],
    [{ anchor: '2/30' }, 'The due date is not valid.'],
    [{ end: 'soon' }, 'The end date is not valid.'],
    [{ frequency: 'custom' as const, intervalCount: '0' }, 'Repeat every 1 or more.'],
    [{ remindDays: '99' }, 'Reminders are 0 to 60 days ahead.'],
    [{ categoryText: 'Nope' }, 'Pick a category from the list.'],
  ])('refuses %o', (patch, message) => {
    expect(buildForm({ ...base, ...patch }, payees, categories)).toEqual({ ok: false, message })
  })
})
