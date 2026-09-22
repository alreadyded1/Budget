import { describe, expect, it } from 'vitest'

import type { Schedule } from '../api/paySchedule'
import { dayCount, describeSchedule, ordinal, parseDate, weekendRuleApplies } from './periods'

function schedule(overrides: Partial<Schedule>): Schedule {
  return {
    id: 1,
    frequency: 'monthly',
    effective_from: '2026-01-01',
    anchor_date: null,
    day_of_month_1: 15,
    day_of_month_2: null,
    weekend_rule: 'none',
    notes: null,
    ...overrides,
  }
}

describe('ordinal', () => {
  it('handles the usual suffixes', () => {
    expect(ordinal(1)).toBe('1st')
    expect(ordinal(2)).toBe('2nd')
    expect(ordinal(3)).toBe('3rd')
    expect(ordinal(4)).toBe('4th')
    expect(ordinal(15)).toBe('15th')
    expect(ordinal(21)).toBe('21st')
    expect(ordinal(31)).toBe('31st')
  })

  it('handles the teens, which break the pattern', () => {
    expect(ordinal(11)).toBe('11th')
    expect(ordinal(12)).toBe('12th')
    expect(ordinal(13)).toBe('13th')
  })
})

describe('parseDate', () => {
  it('reads a plain calendar date in local time, not UTC', () => {
    const parsed = parseDate('2026-03-15')

    expect(parsed.getFullYear()).toBe(2026)
    expect(parsed.getMonth()).toBe(2)
    expect(parsed.getDate()).toBe(15)
  })
})

describe('dayCount', () => {
  it('counts both endpoints', () => {
    expect(dayCount('2026-01-01', '2026-01-01')).toBe(1)
    expect(dayCount('2026-01-01', '2026-01-14')).toBe(14)
  })

  it('survives a month and a year boundary', () => {
    expect(dayCount('2026-01-31', '2026-02-01')).toBe(2)
    expect(dayCount('2026-12-31', '2027-01-01')).toBe(2)
  })

  it('counts a leap day', () => {
    expect(dayCount('2028-02-28', '2028-03-01')).toBe(3)
  })
})

describe('weekendRuleApplies', () => {
  it('is true only where a pay date can land on any weekday', () => {
    expect(weekendRuleApplies('monthly')).toBe(true)
    expect(weekendRuleApplies('semimonthly')).toBe(true)
    expect(weekendRuleApplies('weekly')).toBe(false)
    expect(weekendRuleApplies('biweekly')).toBe(false)
  })
})

describe('describeSchedule', () => {
  it('describes a monthly schedule with its weekend rule', () => {
    const text = describeSchedule(
      schedule({ frequency: 'monthly', day_of_month_1: 1, weekend_rule: 'previous_business_day' }),
    )

    expect(text).toContain('Monthly on the 1st')
    expect(text).toContain('previous business day')
  })

  it('orders the two semimonthly days', () => {
    const text = describeSchedule(
      schedule({ frequency: 'semimonthly', day_of_month_1: 31, day_of_month_2: 15 }),
    )

    expect(text).toBe('Twice a month on the 15th and 31st, no weekend adjustment')
  })

  it('names the weekday for weekly and biweekly, and omits the weekend rule', () => {
    const weekly = describeSchedule(
      schedule({
        frequency: 'weekly',
        anchor_date: '2026-01-02',
        weekend_rule: 'next_business_day',
      }),
    )

    expect(weekly).toBe('Every Friday')
    expect(weekly).not.toContain('business day')
  })
})
