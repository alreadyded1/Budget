/** Formatting helpers for pay periods. Dates are plain YYYY-MM-DD strings. */

import type { Frequency, Schedule, WeekendRule } from '../api/paySchedule'

const ORDINALS = ['th', 'st', 'nd', 'rd']

export function ordinal(day: number): string {
  const remainder = day % 100
  if (remainder >= 11 && remainder <= 13) return `${day}th`
  return `${day}${ORDINALS[day % 10] ?? 'th'}`
}

/** Parses YYYY-MM-DD as a local date, never UTC, so the day never slips. */
export function parseDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function formatDate(iso: string): string {
  return parseDate(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatRange(startIso: string, endIso: string): string {
  return `${formatDate(startIso)} — ${formatDate(endIso)}`
}

export function dayCount(startIso: string, endIso: string): number {
  const ms = parseDate(endIso).getTime() - parseDate(startIso).getTime()
  return Math.round(ms / 86_400_000) + 1
}

const WEEKEND_RULE_TEXT: Record<WeekendRule, string> = {
  none: 'no weekend adjustment',
  previous_business_day: 'moved to the previous business day when it lands on a weekend',
  next_business_day: 'moved to the next business day when it lands on a weekend',
}

/** The weekend rule only applies where a pay date can land on any weekday. */
export function weekendRuleApplies(frequency: Frequency): boolean {
  return frequency === 'monthly' || frequency === 'semimonthly'
}

export function describeSchedule(schedule: Schedule): string {
  const rule = weekendRuleApplies(schedule.frequency)
    ? `, ${WEEKEND_RULE_TEXT[schedule.weekend_rule]}`
    : ''

  switch (schedule.frequency) {
    case 'weekly':
    case 'biweekly': {
      const weekday = schedule.anchor_date
        ? parseDate(schedule.anchor_date).toLocaleDateString(undefined, { weekday: 'long' })
        : 'the anchor day'
      return schedule.frequency === 'weekly'
        ? `Every ${weekday}`
        : `Every other ${weekday}, from ${formatDate(schedule.anchor_date ?? schedule.effective_from)}`
    }
    case 'monthly':
      return `Monthly on the ${ordinal(schedule.day_of_month_1 ?? 1)}${rule}`
    case 'semimonthly': {
      const days = [schedule.day_of_month_1 ?? 1, schedule.day_of_month_2 ?? 15].sort(
        (a, b) => a - b,
      )
      return `Twice a month on the ${ordinal(days[0])} and ${ordinal(days[1])}${rule}`
    }
  }
}
