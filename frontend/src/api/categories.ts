import { apiFetch } from './client'

export type Category = {
  id: number
  group_id: number
  name: string
  sort_order: number
  is_hidden: boolean
  is_sinking_fund: boolean
  default_planned_cents: number
}

export type CategoryGroup = {
  id: number
  name: string
  kind: 'expense' | 'income'
  sort_order: number
  is_hidden: boolean
  categories: Category[]
}

export function fetchGroups(signal?: AbortSignal): Promise<{ items: CategoryGroup[] }> {
  return apiFetch('/category-groups', { signal })
}

export function createGroup(body: { name: string; kind: 'expense' | 'income' }) {
  return apiFetch<CategoryGroup>('/category-groups', { method: 'POST', body })
}

export function createCategory(body: { group_id: number; name: string }) {
  return apiFetch<Category>('/categories', { method: 'POST', body })
}

export function updateCategory(
  id: number,
  body: Partial<Pick<Category, 'name' | 'is_hidden' | 'is_sinking_fund' | 'default_planned_cents'>>,
) {
  return apiFetch<Category>(`/categories/${id}`, { method: 'PATCH', body })
}

export function moveCategory(id: number, offset: number): Promise<{ items: CategoryGroup[] }> {
  return apiFetch(`/categories/${id}/move`, { method: 'POST', body: { offset } })
}

export function moveGroup(id: number, offset: number): Promise<{ items: CategoryGroup[] }> {
  return apiFetch(`/category-groups/${id}/move`, { method: 'POST', body: { offset } })
}

export function deleteCategory(id: number, reassignTo?: number): Promise<void> {
  const query = reassignTo ? `?reassign_to=${reassignTo}` : ''
  return apiFetch<void>(`/categories/${id}${query}`, { method: 'DELETE' })
}

export function seedStarterCategories(): Promise<{ items: CategoryGroup[] }> {
  return apiFetch('/categories/seed-starter', { method: 'POST' })
}
