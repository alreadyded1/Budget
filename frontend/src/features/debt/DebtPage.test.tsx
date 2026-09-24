// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DebtPlan, Simulation } from '../../api/netWorth'
import { ToastProvider } from '../../components/Toast'
import { DebtPage } from './DebtPage'

const PLAN: DebtPlan = {
  strategy: 'avalanche',
  extra_monthly_cents: 0,
  custom_order: [],
  debts: [
    { account_id: 10, name: 'Visa', owed_cents: 250000, apr_bps: 2499, min_payment_cents: 7500 },
    {
      account_id: 11,
      name: 'Store card',
      owed_cents: 60000,
      apr_bps: 1999,
      min_payment_cents: 2500,
    },
  ],
  skipped: [
    {
      account_id: 12,
      name: 'Car',
      owed_cents: 900000,
      apr_bps: null,
      min_payment_cents: 30000,
      reason: 'needs its APR',
    },
  ],
}

function simulation(extra: number, strategy: string): Simulation {
  const result = (name: 'snowball' | 'avalanche' | 'custom', interest: number) => ({
    strategy: name,
    order: [10, 11],
    months: 20,
    finished: true,
    debt_free: '2028-05',
    total_interest_cents: interest,
    total_paid_cents: 310000 + interest,
    payoffs: [
      { account_id: 10, month_index: 14, month: '2027-11' },
      { account_id: 11, month_index: 20, month: '2028-05' },
    ],
  })
  return {
    extra_monthly_cents: extra,
    strategies: [result('snowball', 52000), result('avalanche', 48000)],
    schedule_strategy: strategy as Simulation['schedule_strategy'],
    schedule: [
      {
        index: 1,
        month: '2026-10',
        lines: [
          { account_id: 10, interest_cents: 5206, payment_cents: 27500, balance_cents: 227706 },
          { account_id: 11, interest_cents: 1000, payment_cents: 2500, balance_cents: 58500 },
        ],
      },
    ],
  }
}

let calls: { method: string; url: string; body: unknown }[] = []

beforeEach(() => {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      const body = init.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method, url, body })
      const json = (value: unknown) => new Response(JSON.stringify(value))
      if (url === '/api/v1/debt-plan' && method === 'PUT') return json({ ...PLAN, ...body })
      if (url === '/api/v1/debt-plan') return json(PLAN)
      if (url.startsWith('/api/v1/debt-plan/simulation')) {
        const params = new URL(url, 'http://x').searchParams
        return json(
          simulation(Number(params.get('extra_cents') ?? 0), params.get('strategy') ?? 'avalanche'),
        )
      }
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
        <MemoryRouter>
          <DebtPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('DebtPage', () => {
  it('lists debts, says why one is left out, and compares strategies', async () => {
    renderPage()
    const table = await screen.findByTestId('debt-table')
    expect(within(table).getByText('24.99%')).toBeTruthy()
    expect(
      within(table).getByRole('link', { name: 'left out: needs its APR' }).getAttribute('href'),
    ).toBe('/accounts')
    const avalanche = await screen.findByTestId('strategy-avalanche')
    expect(avalanche.textContent).toContain('$480.00')
    expect(avalanche.textContent).toContain('(shown below)')
    expect(screen.getByTestId('debt-schedule-table').textContent).toContain('$275.00')
  })

  it('tries an extra payment and strategy, then saves them', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('strategy-avalanche')
    await user.type(screen.getByLabelText('Extra each month'), '200')
    await user.click(screen.getByLabelText('Snowball (smallest balance first)'))
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.url === '/api/v1/debt-plan/simulation?extra_cents=20000&strategy=snowball',
        ),
      ).toBe(true),
    )
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Save plan' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
        strategy: 'snowball',
        extra_monthly_cents: 20000,
        custom_order: [10, 11],
      }),
    )
  })

  it('orders a custom plan with Alt+arrows', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('strategy-avalanche')
    await user.click(screen.getByLabelText('Custom order'))
    const list = screen.getByRole('list', { name: 'Custom order' })
    within(list).getAllByRole('listitem')[0].focus()
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([expect.stringContaining('Store card'), expect.stringContaining('Visa')])
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('strategy=custom&order=11&order=10'))).toBe(true),
    )
  })
})
