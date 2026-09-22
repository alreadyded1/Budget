import type { User } from './auth'
import { apiFetch } from './client'

export function fetchUsers(signal?: AbortSignal): Promise<{ items: User[] }> {
  return apiFetch<{ items: User[] }>('/users', { signal })
}

export function createUser(body: {
  username: string
  display_name: string
  password: string
}): Promise<User> {
  return apiFetch<User>('/users', { method: 'POST', body })
}

export function updateUser(
  id: number,
  body: { display_name?: string; is_active?: boolean },
): Promise<User> {
  return apiFetch<User>(`/users/${id}`, { method: 'PATCH', body })
}

export function resetPassword(id: number, password: string): Promise<User> {
  return apiFetch<User>(`/users/${id}/password`, { method: 'POST', body: { password } })
}
