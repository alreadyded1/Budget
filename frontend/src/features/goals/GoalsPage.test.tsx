// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Goal } from '../../api/goals'
import { ToastProvider } from '../../components/Toast'
import { GoalsPage } from './GoalsPage'

const FUND: Goal = {
  id: 1,
  name: 'Car insurance',
  type: 'sinking_fund',
  target_cents: 60000,
  target_date: '2026-11-19',
  account_id: null,
  category_id: 4,
  starting_balance_cents: 10000,
  start_date: '2026-09-11',
  is_archived: false,
  notes: null,
  progress_cents: 20000,
  remaining_cents: 40000,
  needed_cents: 15000,
  periods_left: 3,
  current_planned_cents: 5000,
  rate_cents: 5000,
  projected_date: '2027-01-14',
  status: 'behind',
  current_period_id: 7,
}

let calls: { method: string; url: string; body: unknown }[] = []
let stored: Goal = FUND

beforeEach(() => {
  calls = []
  stored = FUND
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      const body = init.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method, url, body })
      const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
      if (url === '/api/v1/goals' && method === 'GET') return json({ items: [stored] })
      if (url === '/api/v1/goals/1/use-suggested') {
        stored = {
          ...FUND,
          current_planned_cents: 15000,
          status: 'on_track',
          projected_date: '2026-11-19',
        }
        return json(stored)
      }
      if (url === '/api/v1/goals' && method === 'POST')
        return json({ ...FUND, id: 2, ...body }, 201)
      if (url.startsWith('/api/v1/category-groups'))
        return json({
          items: [
            {
              id: 1,
              name: 'Living',
              kind: 'expense',
              is_hidden: false,
              categories: [
                { id: 4, name: 'Car insurance', is_hidden: false },
                { id: 5, name: 'Gifts', is_hidden: false },
              ],
            },
            {
              id: 2,
              name: 'Income',
              kind: 'income',
              is_hidden: false,
              categories: [{ id: 9, name: 'Salary', is_hidden: false }],
            },
          ],
        })
      if (url.startsWith('/api/v1/settings')) return json({})
      return json({ items: [] })
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
        <GoalsPage />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('GoalsPage', () => {
  it('shows progress, the suggestion and a status in words', async () => {
    renderPage()
    const card = await screen.findByTestId('goal-card')
    expect(within(card).getByTestId('goal-progress').textContent).toBe('$200.00 of $600.00')
    expect(within(card).getByTestId('goal-needed').textContent).toBe('$150.00 × 3')
    expect(within(card).getByTestId('goal-status').textContent).toBe('▲ Behind')
    expect(within(card).getByTestId('goal-projected').textContent).toBe('Around 2027-01-14')
    expect(within(card).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('33')
  })

  it('uses the suggested contribution', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(
      await screen.findByRole('button', { name: 'Use suggested contribution ($150.00)' }),
    )
    await waitFor(() => expect(screen.getByTestId('goal-status').textContent).toBe('● On track'))
    expect(
      calls.some((call) => call.method === 'POST' && call.url === '/api/v1/goals/1/use-suggested'),
    ).toBe(true)
    // The plan now matches, so the button goes away.
    expect(screen.queryByRole('button', { name: /Use suggested contribution/ })).toBeNull()
  })

  it('adds a sinking fund from the keyboard, expense categories only', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Add goal' }))
    await user.keyboard('Gifts{Tab}300{Tab}{Tab}')
    await user.keyboard('Sal')
    expect(screen.queryByRole('option', { name: /Salary/ })).toBeNull()
    await user.clear(screen.getByLabelText('Fund category'))
    await user.keyboard('Gif{Tab}50{Enter}')
    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true))
    expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({
      name: 'Gifts',
      type: 'sinking_fund',
      target_cents: 30000,
      category_id: 5,
      starting_balance_cents: 5000,
      account_id: null,
    })
  })

  it('Enter with a missing field explains instead of saving', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Add goal' }))
    await user.keyboard('Gifts{Enter}')
    expect(screen.getByRole('alert').textContent).toMatch(/target amount/)
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('goal-form')).toBeNull()
  })
})
