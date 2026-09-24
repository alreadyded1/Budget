import { apiFetch } from './client'

export type MatchField = 'description' | 'memo'
export type MatchType = 'contains' | 'starts_with' | 'equals' | 'regex'

export type RuleInput = {
  name: string
  is_active: boolean
  match_field: MatchField
  match_type: MatchType
  match_value: string
  amount_min_cents: number | null
  amount_max_cents: number | null
  account_id: number | null
  set_payee_id: number | null
  set_category_id: number | null
  set_memo: string | null
}

export type Rule = RuleInput & { id: number; priority: number }

export type RuleTestResult = {
  checked: number
  matches: {
    date: string
    amount_cents: number
    raw_description: string
    raw_memo: string
    account_id: number
  }[]
}

export const EMPTY_RULE: RuleInput = {
  name: '',
  is_active: true,
  match_field: 'description',
  match_type: 'contains',
  match_value: '',
  amount_min_cents: null,
  amount_max_cents: null,
  account_id: null,
  set_payee_id: null,
  set_category_id: null,
  set_memo: null,
}

export function fetchRules(signal?: AbortSignal): Promise<{ items: Rule[] }> {
  return apiFetch('/rules', { signal })
}

export function createRule(body: RuleInput): Promise<Rule> {
  return apiFetch('/rules', { method: 'POST', body })
}

export function updateRule(id: number, body: Partial<RuleInput>): Promise<Rule> {
  return apiFetch(`/rules/${id}`, { method: 'PATCH', body })
}

export function deleteRule(id: number): Promise<void> {
  return apiFetch(`/rules/${id}`, { method: 'DELETE' })
}

export function moveRule(id: number, offset: number): Promise<{ items: Rule[] }> {
  return apiFetch(`/rules/${id}/move`, { method: 'POST', body: { offset } })
}

export function testRule(body: RuleInput): Promise<RuleTestResult> {
  return apiFetch('/rules/test', { method: 'POST', body })
}
