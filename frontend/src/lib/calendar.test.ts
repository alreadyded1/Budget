import { describe, expect, it } from 'vitest'

import { addMonths, dayOfWeek, monthGrid, weekdayLabels } from './calendar'

describe('monthGrid', () => {
  it('covers September 2026 in whole Sunday-first weeks', () => {
    const weeks = monthGrid('2026-09-15', 0)
    expect(weeks).toHaveLength(5)
    expect(weeks[0][0]).toBe('2026-08-30') // the Sunday before Tue Sep 1
    expect(weeks[0][2]).toBe('2026-09-01')
    expect(weeks[4][6]).toBe('2026-10-03')
    expect(weeks.every((week) => week.length === 7)).toBe(true)
  })

  it('honours a Monday week start', () => {
    const weeks = monthGrid('2026-09-01', 1)
    expect(weeks[0][0]).toBe('2026-08-31')
    expect(dayOfWeek(weeks[0][0])).toBe(1)
  })

  it('needs no leading days when the month starts on the week start', () => {
    // Feb 2026 starts on a Sunday and has exactly 28 days: four rows.
    const weeks = monthGrid('2026-02-01', 0)
    expect(weeks).toHaveLength(4)
    expect(weeks[0][0]).toBe('2026-02-01')
    expect(weeks[3][6]).toBe('2026-02-28')
  })

  it('stretches to six rows when it must', () => {
    // Aug 2026 starts on a Saturday: 1 + 30 days need six Sunday-first rows.
    expect(monthGrid('2026-08-01', 0)).toHaveLength(6)
  })
})

describe('helpers', () => {
  it('steps months across years', () => {
    expect(addMonths('2026-12-01', 1)).toBe('2027-01-01')
    expect(addMonths('2026-01-31', -1)).toBe('2025-12-01')
    expect(addMonths('2026-03-01', 13)).toBe('2027-04-01')
  })

  it('labels weekdays from the week start', () => {
    expect(weekdayLabels(0)[0]).toBe('Sun')
    expect(weekdayLabels(1)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
  })
})
