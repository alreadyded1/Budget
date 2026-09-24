import { describe, expect, it } from 'vitest'

import { addDays, isValidIsoDate, isoDate, parseDateInput, todayIso } from './dates'

const TODAY = '2026-09-23'

describe('parseDateInput', () => {
  it('reads t as today', () => {
    expect(parseDateInput('t', TODAY)).toBe(TODAY)
    expect(parseDateInput(' T ', TODAY)).toBe(TODAY)
  })

  it('steps a day with + and - from the current value', () => {
    expect(parseDateInput('+', TODAY, '2026-02-28')).toBe('2026-03-01')
    expect(parseDateInput('-', TODAY, '2026-03-01')).toBe('2026-02-28')
    expect(parseDateInput('+', TODAY, '2024-02-28')).toBe('2024-02-29')
    expect(parseDateInput('+', TODAY, '2026-12-31')).toBe('2027-01-01')
    expect(parseDateInput('-', TODAY, '2027-01-01')).toBe('2026-12-31')
  })

  it('steps from today when there is no current value', () => {
    expect(parseDateInput('+', TODAY)).toBe('2026-09-24')
    expect(parseDateInput('-', TODAY, 'garbage')).toBe('2026-09-22')
  })

  it('reads a bare day as that day of this month', () => {
    expect(parseDateInput('15', TODAY)).toBe('2026-09-15')
    expect(parseDateInput('1', TODAY)).toBe('2026-09-01')
    expect(parseDateInput('05', TODAY)).toBe('2026-09-05')
  })

  it('refuses a day this month does not have', () => {
    expect(parseDateInput('31', TODAY)).toBeNull()
    expect(parseDateInput('0', TODAY)).toBeNull()
    expect(parseDateInput('32', TODAY)).toBeNull()
    expect(parseDateInput('29', '2026-02-10')).toBeNull()
    expect(parseDateInput('29', '2028-02-10')).toBe('2028-02-29')
  })

  it('reads month/day as this year', () => {
    expect(parseDateInput('3/15', TODAY)).toBe('2026-03-15')
    expect(parseDateInput('12/1', TODAY)).toBe('2026-12-01')
    expect(parseDateInput('3.15', TODAY)).toBe('2026-03-15')
  })

  it('takes full dates as written', () => {
    expect(parseDateInput('3/15/2025', TODAY)).toBe('2025-03-15')
    expect(parseDateInput('3/15/25', TODAY)).toBe('2025-03-15')
    expect(parseDateInput('2025-03-15', TODAY)).toBe('2025-03-15')
    expect(parseDateInput('2025-3-5', TODAY)).toBe('2025-03-05')
  })

  it('refuses impossible and malformed dates', () => {
    expect(parseDateInput('2/30', TODAY)).toBeNull()
    expect(parseDateInput('2/29/2026', TODAY)).toBeNull()
    expect(parseDateInput('13/1', TODAY)).toBeNull()
    expect(parseDateInput('2026-13-01', TODAY)).toBeNull()
    expect(parseDateInput('', TODAY)).toBeNull()
    expect(parseDateInput('tomorrow', TODAY)).toBeNull()
    expect(parseDateInput('3/15/202', TODAY)).toBeNull()
    expect(parseDateInput('++', TODAY)).toBeNull()
  })
})

describe('date helpers', () => {
  it('validates ISO dates', () => {
    expect(isValidIsoDate('2024-02-29')).toBe(true)
    expect(isValidIsoDate('2023-02-29')).toBe(false)
    expect(isValidIsoDate('2023-2-1')).toBe(true)
    expect(isValidIsoDate('02/01/2023')).toBe(false)
  })

  it('builds and steps dates without drifting across month ends', () => {
    expect(isoDate(2026, 1, 31)).toBe('2026-01-31')
    expect(isoDate(2026, 4, 31)).toBeNull()
    expect(addDays('2026-01-31', 30)).toBe('2026-03-02')
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09') // US DST starts; no hour to lose
  })

  it('reads today from the local calendar', () => {
    expect(todayIso(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})
