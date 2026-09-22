import { apiFetch } from './client'

export type HouseholdSettings = {
  household_name: string
  currency_symbol: string
  week_start: number
  theme_default: 'light' | 'dark' | 'system'
  ntfy_url: string | null
  ntfy_topic: string | null
  reminder_hour: number
  prefill_last_amount: boolean
}

export type SettingsPatch = Partial<Omit<HouseholdSettings, 'ntfy_url' | 'ntfy_topic'>>

export function fetchSettings(signal?: AbortSignal): Promise<HouseholdSettings> {
  return apiFetch<HouseholdSettings>('/settings', { signal })
}

export function patchSettings(body: SettingsPatch): Promise<HouseholdSettings> {
  return apiFetch<HouseholdSettings>('/settings', { method: 'PATCH', body })
}
