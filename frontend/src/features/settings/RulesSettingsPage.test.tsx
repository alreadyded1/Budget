// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EMPTY_RULE } from '../../api/rules'
import type { Rule } from '../../api/rules'
import { ToastProvider } from '../../components/Toast'
import { RulesSettingsPage } from './RulesSettingsPage'

const RULES: Rule[] = [
  { ...EMPTY_RULE, id: 1, priority: 0, name: 'kroger', match_value: 'kroger', set_memo: 'food' },
  { ...EMPTY_RULE, id: 2, priority: 1, name: 'shell', match_value: 'shell', set_memo: 'fuel' },
]

let calls: { method: string; url: string; body: unknown }[] = []

beforeEach(() => {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      const body = init.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method, url, body })
      if (url === '/api/v1/rules/2/move')
        return new Response(JSON.stringify({ items: [RULES[1], RULES[0]] }))
      if (url === '/api/v1/rules/test')
        return new Response(
          JSON.stringify({
            checked: 12,
            matches: [
              {
                date: '2026-09-02',
                amount_cents: -4520,
                raw_description: 'KROGER',
                raw_memo: '',
                account_id: 1,
              },
            ],
          }),
        )
      if (url === '/api/v1/rules') return new Response(JSON.stringify({ items: RULES }))
      if (url.startsWith('/api/v1/settings')) return new Response(JSON.stringify({}))
      return new Response(JSON.stringify({ items: [] }))
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <RulesSettingsPage />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('RulesSettingsPage', () => {
  it('lists rules in order and moves the focused one with Alt+Up', async () => {
    const user = userEvent.setup()
    renderPage()
    const rows = await screen.findAllByTestId('rule-row')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('“kroger”'),
      expect.stringContaining('“shell”'),
    ])

    rows[1].focus()
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}')

    await waitFor(() =>
      expect(calls.find((call) => call.url === '/api/v1/rules/2/move')?.body).toEqual({
        offset: -1,
      }),
    )
    await waitFor(() =>
      expect(screen.getAllByTestId('rule-row')[0].textContent).toContain('“shell”'),
    )
  })

  it('tests a new rule against past imports before saving', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByText('Add rule'))
    await user.type(screen.getByLabelText('Match text'), 'kroger')
    await user.click(screen.getByText('Test against past imports'))
    expect((await screen.findByTestId('rule-test-result')).textContent).toContain(
      'Matches 1 of the last 12 imported rows',
    )
    expect(calls.some((call) => call.method === 'POST' && call.url === '/api/v1/rules')).toBe(false)
  })

  it('refuses a rule that does nothing', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByText('Add rule'))
    await user.type(screen.getByLabelText('Match text'), 'kroger{Enter}')
    expect(screen.getByRole('alert').textContent).toMatch(/needs something to do/)
  })
})
