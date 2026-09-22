import { apiFetch } from './client'

export type Frequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly'
export type WeekendRule = 'none' | 'previous_business_day' | 'next_business_day'

export type Schedule = {
  id: number
  frequency: Frequency
  effective_from: string
  anchor_date: string | null
  day_of_month_1: number | null
  day_of_month_2: number | null
  weekend_rule: WeekendRule
  notes: string | null
}

export type ScheduleInput = {
  frequency: Frequency
  effective_from: string
  anchor_date?: string | null
  day_of_month_1?: number | null
  day_of_month_2?: number | null
  weekend_rule: WeekendRule
  notes?: string | null
}

export type PreviewPeriod = {
  start_date: string
  end_date: string
  is_transition: boolean
  days: number
}

export type Preview = {
  first_pay_date: string
  periods: PreviewPeriod[]
  transition: PreviewPeriod | null
  unshifted_dates: string[]
}

export type PayPeriod = {
  id: number
  start_date: string
  end_date: string
  schedule_id: number
  is_transition: boolean
  days: number
}

export function fetchSchedule(signal?: AbortSignal): Promise<{
  current: Schedule | null
  history: Schedule[]
}> {
  return apiFetch('/pay-schedule', { signal })
}

export function previewSchedule(body: ScheduleInput): Promise<Preview> {
  return apiFetch<Preview>('/pay-schedule/preview', { method: 'POST', body })
}

export function commitSchedule(body: ScheduleInput): Promise<Schedule> {
  return apiFetch<Schedule>('/pay-schedule', { method: 'POST', body })
}

export function fetchPeriods(
  range: { from?: string; to?: string } = {},
  signal?: AbortSignal,
): Promise<{ items: PayPeriod[] }> {
  const params = new URLSearchParams()
  if (range.from) params.set('from', range.from)
  if (range.to) params.set('to', range.to)
  const query = params.toString()
  return apiFetch(`/pay-periods${query ? `?${query}` : ''}`, { signal })
}

export function fetchCurrentPeriod(signal?: AbortSignal): Promise<PayPeriod> {
  return apiFetch<PayPeriod>('/pay-periods/current', { signal })
}
