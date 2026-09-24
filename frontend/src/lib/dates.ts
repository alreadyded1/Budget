/** Plain calendar dates (`YYYY-MM-DD`) and the date field's typing shortcuts (SPEC §7).
 *
 * Everything works on the ISO string through UTC arithmetic, so no local timezone can
 * move a date by a day.
 */

const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})$/
const SLASHED = /^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?$/
const DAY_ONLY = /^\d{1,2}$/

export function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const probe = new Date(Date.UTC(year, month - 1, day))
  // Date.UTC quietly rolls 2/30 over into March; a rolled date is not what was typed.
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null
  return probe.toISOString().slice(0, 10)
}

export function isValidIsoDate(value: string): boolean {
  const match = ISO.exec(value)
  if (match === null) return false
  return isoDate(Number(match[1]), Number(match[2]), Number(match[3])) !== null
}

export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

/** Today in the browser's own calendar, which is the calendar the household lives in. */
export function todayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** Reads what was typed into a date field. Returns an ISO date, or null if it isn't one.
 *
 * - `t` is today; `+` / `-` step a day from `current` (or today when it is empty)
 * - `15` is the 15th of this month, `3/15` is March 15 this year
 * - `3/15/2026`, `3/15/26` and `2026-03-15` are taken as written
 */
export function parseDateInput(input: string, today: string, current?: string): string | null {
  const text = input.trim().toLowerCase()
  const [thisYear, thisMonth] = today.split('-').map(Number)
  const base = current && isValidIsoDate(current) ? current : today

  if (text === 't' || text === 'today') return today
  if (text === '+') return addDays(base, 1)
  if (text === '-') return addDays(base, -1)

  if (DAY_ONLY.test(text)) return isoDate(thisYear, thisMonth, Number(text))

  const slashed = SLASHED.exec(text)
  if (slashed !== null) {
    const [, month, day, year] = slashed
    let fullYear = thisYear
    if (year !== undefined) fullYear = year.length === 2 ? 2000 + Number(year) : Number(year)
    return isoDate(fullYear, Number(month), Number(day))
  }

  const iso = ISO.exec(text)
  if (iso !== null) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  return null
}
