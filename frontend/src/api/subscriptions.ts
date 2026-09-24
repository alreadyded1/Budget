import { apiFetch } from './client'

export type Frequency =
  'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'custom'
export type IntervalUnit = 'day' | 'week' | 'month'
export type SubscriptionStatus = 'active' | 'paused' | 'cancelled'
export type BillStatus = 'upcoming' | 'paid' | 'skipped'

export type Subscription = {
  id: number
  name: string
  payee_id: number | null
  category_id: number | null
  account_id: number | null
  amount_cents: number
  frequency: Frequency
  interval_count: number
  interval_unit: IntervalUnit | null
  anchor_date: string
  day_of_month: number | null
  start_date: string
  end_date: string | null
  status: SubscriptionStatus
  auto_post: boolean
  remind_days_before: number
  url: string | null
  notes: string | null
  next_due_date: string | null
  monthly_cents: number
  annual_cents: number
  previous_amount_cents: number | null
  price_increased: boolean
  price_history: { effective_date: string; amount_cents: number }[]
}

export type SubscriptionList = {
  items: Subscription[]
  monthly_cents: number
  annual_cents: number
  by_category: { category_id: number | null; monthly_cents: number; annual_cents: number }[]
}

export type SubscriptionInput = {
  name: string
  payee_id: number | null
  category_id: number | null
  account_id: number | null
  amount_cents: number
  frequency: Frequency
  interval_count: number
  interval_unit: IntervalUnit | null
  anchor_date: string
  end_date: string | null
  status: SubscriptionStatus
  auto_post: boolean
  remind_days_before: number
  url: string | null
  notes: string | null
}

export type Bill = {
  occurrence_id: number
  subscription_id: number
  name: string
  payee_id: number | null
  category_id: number | null
  account_id: number | null
  due_date: string
  amount_cents: number
  status: BillStatus
  overdue: boolean
  transaction_id: number | null
  url: string | null
}

export function fetchSubscriptions(signal?: AbortSignal): Promise<SubscriptionList> {
  return apiFetch('/subscriptions', { signal })
}

export function createSubscription(body: SubscriptionInput): Promise<Subscription> {
  return apiFetch('/subscriptions', { method: 'POST', body })
}

export function updateSubscription(
  id: number,
  body: Partial<SubscriptionInput>,
): Promise<Subscription> {
  return apiFetch(`/subscriptions/${id}`, { method: 'PATCH', body })
}

export function deleteSubscription(id: number): Promise<void> {
  return apiFetch(`/subscriptions/${id}`, { method: 'DELETE' })
}

export function fetchBills(
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<{ items: Bill[] }> {
  return apiFetch(`/bills?from=${from}&to=${to}`, { signal })
}

export function fetchBill(occurrenceId: number, signal?: AbortSignal): Promise<Bill> {
  return apiFetch(`/bills/${occurrenceId}`, { signal })
}

export function payBill(occurrenceId: number, transactionId: number | null = null): Promise<Bill> {
  return apiFetch(`/bills/${occurrenceId}/pay`, {
    method: 'POST',
    body: { transaction_id: transactionId },
  })
}

export function skipBill(occurrenceId: number): Promise<Bill> {
  return apiFetch(`/bills/${occurrenceId}/skip`, { method: 'POST' })
}

export function reopenBill(occurrenceId: number): Promise<Bill> {
  return apiFetch(`/bills/${occurrenceId}/reopen`, { method: 'POST' })
}

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semiannual: 'Twice a year',
  annual: 'Yearly',
  custom: 'Custom',
}

export function describeFrequency(
  sub: Pick<Subscription, 'frequency' | 'interval_count' | 'interval_unit'>,
): string {
  if (sub.frequency !== 'custom') return FREQUENCY_LABEL[sub.frequency]
  const unit = sub.interval_unit ?? 'month'
  return sub.interval_count === 1 ? `Every ${unit}` : `Every ${sub.interval_count} ${unit}s`
}
