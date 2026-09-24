import { apiFetch } from './client'

export type AccountType =
  | 'checking'
  | 'savings'
  | 'credit_card'
  | 'cash'
  | 'loan'
  | 'mortgage'
  | 'investment'
  | 'other_asset'
  | 'other_liability'

export type Account = {
  id: number
  name: string
  type: AccountType
  on_budget: boolean
  opening_balance_cents: number
  opening_date: string
  institution: string | null
  last4: string | null
  sort_order: number
  is_closed: boolean
  valuation_mode: 'transactions' | 'manual'
  apr_bps: number | null
  min_payment_cents: number | null
  payment_due_day: number | null
  low_balance_alert_cents: number | null
  is_liability: boolean
  closed_on?: string | null
}

export type AccountInput = {
  name: string
  type: AccountType
  on_budget?: boolean | null
  opening_balance_cents?: number
  opening_date?: string | null
  institution?: string | null
  last4?: string | null
  valuation_mode?: 'transactions' | 'manual'
  apr_bps?: number | null
  min_payment_cents?: number | null
  payment_due_day?: number | null
  low_balance_alert_cents?: number | null
}

export function fetchAccounts(signal?: AbortSignal): Promise<{ items: Account[] }> {
  return apiFetch('/accounts', { signal })
}

export function createAccount(body: AccountInput): Promise<Account> {
  return apiFetch<Account>('/accounts', { method: 'POST', body })
}

export function updateAccount(id: number, body: Partial<AccountInput>): Promise<Account> {
  return apiFetch<Account>(`/accounts/${id}`, { method: 'PATCH', body })
}

export function setAccountClosed(id: number, closed: boolean): Promise<Account> {
  return apiFetch<Account>(`/accounts/${id}/${closed ? 'close' : 'reopen'}`, { method: 'POST' })
}

export type Valuation = {
  id: number
  account_id: number
  date: string
  balance_cents: number
  note: string | null
}

export function fetchValuations(
  accountId: number,
  signal?: AbortSignal,
): Promise<{ items: Valuation[] }> {
  return apiFetch(`/accounts/${accountId}/valuations`, { signal })
}

export function addValuation(
  accountId: number,
  body: { date: string; balance_cents: number; note?: string | null },
): Promise<Valuation> {
  return apiFetch(`/accounts/${accountId}/valuations`, { method: 'POST', body })
}

export function deleteValuation(accountId: number, valuationId: number): Promise<void> {
  return apiFetch(`/accounts/${accountId}/valuations/${valuationId}`, { method: 'DELETE' })
}
