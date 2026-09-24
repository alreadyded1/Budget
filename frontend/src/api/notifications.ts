import { apiFetch } from './client'

export type NotificationKind =
  'bill_due' | 'bill_overdue' | 'low_balance' | 'auto_post' | 'backup_failed' | 'test'

export type NotificationEntry = {
  id: number
  kind: NotificationKind
  ref_key: string
  title: string
  message: string
  sent_at: string
  success: boolean
  error: string | null
}

export function fetchNotifications(
  limit = 100,
  signal?: AbortSignal,
): Promise<{ items: NotificationEntry[] }> {
  return apiFetch(`/notifications?limit=${limit}`, { signal })
}

export function sendTestNotification(): Promise<{ success: boolean; error: string | null }> {
  return apiFetch('/notifications/test', { method: 'POST' })
}
