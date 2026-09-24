import { apiFetch } from './client'

export type Payee = {
  id: number
  name: string
  default_category_id: number | null
  notes: string | null
  is_hidden: boolean
  transaction_count: number
  last_used: string | null
  total_spent_cents: number
  last_category_id: number | null
  last_amount_cents: number | null
}

export function fetchPayees(search = '', signal?: AbortSignal): Promise<{ items: Payee[] }> {
  const query = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''
  return apiFetch(`/payees${query}`, { signal })
}

export function createPayee(body: { name: string }): Promise<Payee> {
  return apiFetch<Payee>('/payees', { method: 'POST', body })
}

export function updatePayee(
  id: number,
  body: Partial<Pick<Payee, 'name' | 'default_category_id' | 'notes' | 'is_hidden'>>,
): Promise<Payee> {
  return apiFetch<Payee>(`/payees/${id}`, { method: 'PATCH', body })
}

export function mergePayees(
  targetId: number,
  sourceId: number,
): Promise<{ payee: Payee; moved: Record<string, number> }> {
  return apiFetch(`/payees/${targetId}/merge`, { method: 'POST', body: { source_id: sourceId } })
}

export function deletePayee(id: number): Promise<void> {
  return apiFetch<void>(`/payees/${id}`, { method: 'DELETE' })
}
