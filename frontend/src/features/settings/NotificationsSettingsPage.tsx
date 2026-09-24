import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { ApiRequestError } from '../../api/client'
import { queryKeys } from '../../api/keys'
import { fetchNotifications, sendTestNotification } from '../../api/notifications'
import type { NotificationKind } from '../../api/notifications'
import { fetchSettings, patchSettings } from '../../api/settings'
import type { HouseholdSettings, SettingsPatch } from '../../api/settings'
import { useToast } from '../../components/toastContext'

const inputClass =
  'mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:bg-slate-950'

const KIND_LABEL: Record<NotificationKind, string> = {
  bill_due: 'Bill due',
  bill_overdue: 'Overdue',
  low_balance: 'Low balance',
  auto_post: 'Auto-post',
  backup_failed: 'Job failed',
  test: 'Test',
}

/** The server's marker on a message held until the reminder hour (app/services/notifications.py). */
const QUEUED = 'waiting for the reminder hour'

function errorText(error: unknown): string {
  return error instanceof ApiRequestError ? error.detail : 'That did not work.'
}

/** Settings → Notifications (SPEC §10): ntfy, the reminder hour, Send test, and the log. */
export function NotificationsSettingsPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const settings = useQuery({
    queryKey: queryKeys.settings,
    queryFn: ({ signal }) => fetchSettings(signal),
  })
  const log = useQuery({
    queryKey: queryKeys.notifications,
    queryFn: ({ signal }) => fetchNotifications(100, signal),
  })
  const [form, setForm] = useState<SettingsPatch>({})
  const [token, setToken] = useState('')

  const save = useMutation({
    mutationFn: patchSettings,
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.settings })
      const previous = queryClient.getQueryData<HouseholdSettings>(queryKeys.settings)
      if (previous) {
        const { ntfy_token, ...visible } = patch
        queryClient.setQueryData<HouseholdSettings>(queryKeys.settings, {
          ...previous,
          ...visible,
          ntfy_token_set: ntfy_token === undefined ? previous.ntfy_token_set : ntfy_token !== '',
        })
      }
      return { previous }
    },
    onError: (error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.settings, context.previous)
      toast(errorText(error))
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.settings, saved)
      setForm({})
      setToken('')
      toast('Notification settings saved.', 'success')
    },
  })

  const test = useMutation({
    mutationFn: sendTestNotification,
    onSuccess: (result) => {
      if (result.success) toast('Test sent. Check your phone.', 'success')
      else toast(`The test did not go through: ${result.error}`)
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications })
    },
    onError: (error) => toast(errorText(error)),
  })

  if (settings.isPending || !settings.data)
    return <p className="text-sm text-slate-500">Loading…</p>
  const value = { ...settings.data, ...form }
  const configured = Boolean(settings.data.ntfy_url && settings.data.ntfy_topic)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const patch: SettingsPatch = { ...form }
    if (token.trim()) patch.ntfy_token = token.trim()
    if (Object.keys(patch).length > 0) save.mutate(patch)
  }

  return (
    <div>
      <form onSubmit={handleSubmit} aria-label="ntfy settings">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Reminders, overdue notices, low-balance alerts, auto-posted bills and failed backups are
          sent through{' '}
          <a
            href="https://ntfy.sh"
            target="_blank"
            rel="noreferrer"
            className="text-sky-600 underline"
          >
            ntfy
          </a>
          . Subscribe to the topic in the ntfy app on your phone.
        </p>

        <label htmlFor="ntfy_url" className="mt-4 block text-sm font-medium">
          Server URL
        </label>
        <input
          id="ntfy_url"
          type="url"
          placeholder="https://ntfy.sh"
          value={value.ntfy_url ?? ''}
          onChange={(event) => setForm({ ...form, ntfy_url: event.target.value })}
          className={inputClass}
        />

        <label htmlFor="ntfy_topic" className="mt-4 block text-sm font-medium">
          Topic
        </label>
        <input
          id="ntfy_topic"
          placeholder="payday-budget-a1b2c3"
          value={value.ntfy_topic ?? ''}
          onChange={(event) => setForm({ ...form, ntfy_topic: event.target.value })}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-slate-500">
          On the public ntfy.sh server anyone who knows the topic can read it, so pick something
          hard to guess, or use a token on your own server.
        </p>

        <label htmlFor="ntfy_token" className="mt-4 block text-sm font-medium">
          Access token <span className="font-normal text-slate-500">(optional)</span>
        </label>
        <input
          id="ntfy_token"
          type="password"
          autoComplete="off"
          placeholder={settings.data.ntfy_token_set ? '•••••• stored — type to replace' : 'tk_…'}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          className={inputClass}
        />
        {settings.data.ntfy_token_set && (
          <button
            type="button"
            onClick={() => save.mutate({ ntfy_token: '' })}
            className="mt-1 text-xs text-rose-600 underline"
          >
            Remove the stored token
          </button>
        )}

        <label htmlFor="reminder_hour" className="mt-4 block text-sm font-medium">
          Send notifications from
        </label>
        <select
          id="reminder_hour"
          value={value.reminder_hour}
          onChange={(event) => setForm({ ...form, reminder_hour: Number(event.target.value) })}
          className={`${inputClass} w-40`}
        >
          {Array.from({ length: 24 }, (_, hour) => (
            <option key={hour} value={hour}>
              {String(hour).padStart(2, '0')}:00
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500">
          The daily job runs every hour. Bills still post on time; messages wait until this hour.
        </p>

        <div className="mt-5 flex gap-2">
          <button
            type="submit"
            disabled={save.isPending}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          >
            Save
          </button>
          <button
            type="button"
            disabled={!configured || test.isPending}
            onClick={() => test.mutate()}
            title={configured ? undefined : 'Save a server URL and topic first'}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            {test.isPending ? 'Sending…' : 'Send test'}
          </button>
        </div>
      </form>

      <h2 className="mt-8 text-sm font-semibold">Recent notifications</h2>
      {log.data && log.data.items.length === 0 && (
        <p className="mt-2 text-sm text-slate-500">Nothing sent yet.</p>
      )}
      {log.data && log.data.items.length > 0 && (
        <table className="mt-2 w-full text-sm" data-testid="notification-log">
          <thead className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800">
            <tr>
              <th className="py-1 pr-2 font-medium">When</th>
              <th className="py-1 pr-2 font-medium">Kind</th>
              <th className="py-1 pr-2 font-medium">Message</th>
              <th className="py-1 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {log.data.items.map((row) => (
              <tr
                key={row.id}
                className="border-b border-slate-100 align-top dark:border-slate-800/70"
              >
                <td className="py-1 pr-2 whitespace-nowrap text-slate-500 tabular-nums">
                  {new Date(row.sent_at).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
                <td className="py-1 pr-2 whitespace-nowrap">{KIND_LABEL[row.kind] ?? row.kind}</td>
                <td className="py-1 pr-2">
                  <div className="font-medium">{row.title}</div>
                  <div className="text-xs text-slate-500">{row.message}</div>
                </td>
                <td className="py-1 text-xs">
                  {row.success ? (
                    <span className="text-emerald-600">sent</span>
                  ) : row.error === QUEUED ? (
                    <span className="text-amber-600">
                      waiting for {String(value.reminder_hour).padStart(2, '0')}:00
                    </span>
                  ) : (
                    <span className="text-rose-600">{row.error ?? 'not sent'}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
