/** Month grids for the bill calendar. Dates are ISO strings; arithmetic is UTC-only. */

import { addDays, isoDate } from './dates'

/** Day of week for an ISO date, 0 = Sunday (the same numbering as settings.week_start). */
export function dayOfWeek(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}

export function addMonths(monthIso: string, count: number): string {
  const [year, month] = monthIso.split('-').map(Number)
  const index = year * 12 + (month - 1) + count
  return isoDate(Math.floor(index / 12), (index % 12) + 1, 1)!
}

/** Whole weeks (7 dates each) covering the month, starting on `weekStart`. */
export function monthGrid(monthIso: string, weekStart = 0): string[][] {
  const first = monthStart(monthIso)
  const lead = (dayOfWeek(first) - weekStart + 7) % 7
  let cursor = addDays(first, -lead)
  const month = first.slice(0, 7)
  const weeks: string[][] = []
  do {
    const week: string[] = []
    for (let day = 0; day < 7; day++) {
      week.push(cursor)
      cursor = addDays(cursor, 1)
    }
    weeks.push(week)
  } while (cursor.slice(0, 7) === month)
  return weeks
}

/** Weekday labels in grid order. */
export function weekdayLabels(weekStart = 0): string[] {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return names.map((_, index) => names[(index + weekStart) % 7])
}

export function monthTitle(monthIso: string): string {
  const [year, month] = monthIso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
