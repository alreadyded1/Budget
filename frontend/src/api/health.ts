import { apiFetch } from './client'

export type Health = {
  status: string
  version: string
  env: string
  database: { ok: boolean; message: string | null }
}

export function fetchHealth(signal?: AbortSignal): Promise<Health> {
  return apiFetch<Health>('/health', { signal })
}
