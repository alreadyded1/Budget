// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '../../components/Toast'
import { NotificationsSettingsPage } from './NotificationsSettingsPage'

const SETTINGS = {
  household_name: 'Home',
  currency_symbol: '$',
  week_start: 0,
  theme_default: 'system',
  ntfy_url: null as string | null,
  ntfy_topic: null as string | null,
  ntfy_token_set: false,
  reminder_hour: 7,
  prefill_last_amount: false,
}

let calls: { method: string; url: string; body: unknown }[] = []
let settings = { ...SETTINGS }

beforeEach(() => {
  calls = []
  settings = { ...SETTINGS }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      const body = init.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method, url, body })
      if (url.startsWith('/api/v1/settings') && method === 'PATCH') {
        const { ntfy_token, ...rest } = body
        settings = { ...settings, ...rest }
        if (ntfy_token !== undefined) settings.ntfy_token_set = ntfy_token !== ''
        return new Response(JSON.stringify(settings))
      }
      if (url.startsWith('/api/v1/settings')) return new Response(JSON.stringify(settings))
      if (url.startsWith('/api/v1/notifications/test')) {
        return new Response(JSON.stringify({ success: true, error: null }))
      }
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 2,
              kind: 'auto_post',
              ref_key: 'occ:5:auto_post',
              title: 'Posted Netflix',
              message: 'Netflix $15.99 was entered.',
              sent_at: '2026-09-24T05:00:00Z',
              success: false,
              error: 'waiting for the reminder hour',
            },
            {
              id: 1,
              kind: 'bill_due',
              ref_key: 'occ:4:due',
              title: 'Rent due tomorrow',
              message: 'Rent $1,200.00 is due.',
              sent_at: '2026-09-23T11:00:00Z',
              success: true,
              error: null,
            },
          ],
        }),
      )
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <NotificationsSettingsPage />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('NotificationsSettingsPage', () => {
  it('shows the log, including a message waiting for the reminder hour', async () => {
    renderPage()
    const log = await screen.findByTestId('notification-log')
    expect(log.textContent).toContain('Posted Netflix')
    expect(log.textContent).toContain('waiting for 07:00')
    expect(log.textContent).toContain('sent')
  })

  it('cannot send a test until a server and topic are saved', async () => {
    const user = userEvent.setup()
    renderPage()
    const button = await screen.findByRole('button', { name: 'Send test' })
    expect((button as HTMLButtonElement).disabled).toBe(true)

    await user.type(screen.getByLabelText('Server URL'), 'https://ntfy.sh')
    await user.type(screen.getByLabelText('Topic'), 'payday-x1')
    await user.type(screen.getByLabelText(/Access token/), 'tk_abc{Enter}')

    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
    const patch = calls.find((call) => call.method === 'PATCH')!
    expect(patch.body).toEqual({
      ntfy_url: 'https://ntfy.sh',
      ntfy_topic: 'payday-x1',
      ntfy_token: 'tk_abc',
    })
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    // The token never comes back; the field says one is stored.
    expect((screen.getByLabelText(/Access token/) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/Access token/) as HTMLInputElement).placeholder).toContain(
      'stored',
    )

    await user.click(button)
    expect(await screen.findByText('Test sent. Check your phone.')).toBeTruthy()
  })
})
