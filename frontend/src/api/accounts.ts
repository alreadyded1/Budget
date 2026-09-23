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
