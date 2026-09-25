import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { FormEvent } from 'react'

import { ApiRequestError } from '../../api/client'
import { queryKeys } from '../../api/keys'
import { fetchSettings, patchSettings } from '../../api/settings'
import type { HouseholdSettings, SettingsPatch } from '../../api/settings'
import { useToast } from '../../components/toastContext'

const WEEK_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const THEMES = ['light', 'dark', 'system'] as const

const inputClass =
  'mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:bg-slate-950'

export function GeneralSettingsPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const { data, isPending } = useQuery({
    queryKey: queryKeys.settings,
    queryFn: ({ signal }) => fetchSettings(signal),
  })

  // The draft holds only the fields the user touched; it is cleared once a save lands.
  const [form, setForm] = useState<SettingsPatch>({})

  const save = useMutation({
    mutationFn: patchSettings,
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.settings })
      const previous = queryClient.getQueryData<HouseholdSettings>(queryKeys.settings)
      if (previous) {
        queryClient.setQueryData<HouseholdSettings>(queryKeys.settings, { ...previous, ...patch })
      }
      return { previous }
    },
    onError: (error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.settings, context.previous)
      toast(error instanceof ApiRequestError ? error.detail : 'Could not save settings.')
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.settings, saved)
      setForm({})
      toast('Settings saved.', 'success')
    },
  })

  if (isPending || !data) {
    return <p className="text-sm text-slate-500">Loading…</p>
  }

  const value = { ...data, ...form }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (Object.keys(form).length > 0) save.mutate(form)
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="household_name" className="block text-sm font-medium">
        Household name
      </label>
      <input
        id="household_name"
        value={value.household_name}
        onChange={(event) => setForm({ ...form, household_name: event.target.value })}
        className={inputClass}
      />

      <label htmlFor="currency_symbol" className="mt-4 block text-sm font-medium">
        Currency symbol
      </label>
      <input
        id="currency_symbol"
        value={value.currency_symbol}
        onChange={(event) => setForm({ ...form, currency_symbol: event.target.value })}
        className={`${inputClass} w-24`}
      />

      <label htmlFor="week_start" className="mt-4 block text-sm font-medium">
        First day of week
      </label>
      <select
        id="week_start"
        value={value.week_start}
        onChange={(event) => setForm({ ...form, week_start: Number(event.target.value) })}
        className={inputClass}
      >
        {WEEK_DAYS.map((day, index) => (
          <option key={day} value={index}>
            {day}
          </option>
        ))}
      </select>

      <label htmlFor="theme_default" className="mt-4 block text-sm font-medium">
        Default theme
      </label>
      <select
        id="theme_default"
        value={value.theme_default}
        onChange={(event) =>
          setForm({
            ...form,
            theme_default: event.target.value as HouseholdSettings['theme_default'],
          })
        }
        className={inputClass}
      >
        {THEMES.map((theme) => (
          <option key={theme} value={theme}>
            {theme}
          </option>
        ))}
      </select>

      <button
        type="submit"
        disabled={save.isPending || Object.keys(form).length === 0}
        className="mt-6 rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
      >
        Save changes
      </button>

      <p className="mt-8 text-sm text-slate-600 dark:text-slate-300">
        <Link to="/setup" className="text-sky-700 underline dark:text-sky-300">
          Run setup again
        </Link>{' '}
        — pay schedule, accounts and categories, one step at a time.
      </p>
    </form>
  )
}
