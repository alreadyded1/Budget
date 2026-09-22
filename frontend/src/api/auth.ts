import { apiFetch } from './client'

export type User = {
  id: number
  username: string
  display_name: string
  is_active: boolean
  last_login_at: string | null
}

export function fetchMe(signal?: AbortSignal): Promise<User> {
  return apiFetch<User>('/auth/me', { signal })
}

export function login(credentials: {
  username: string
  password: string
}): Promise<{ user: User }> {
  return apiFetch<{ user: User }>('/auth/login', { method: 'POST', body: credentials })
}

export function logout(): Promise<void> {
  return apiFetch<void>('/auth/logout', { method: 'POST' })
}
