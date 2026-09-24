// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BudgetView, PlanLine } from '../../api/budget'
import { ToastProvider } from '../../components/Toast'
import { BudgetPage } from './BudgetPage'
import { withPlanned } from './budgetMath'

function line(
  id: number,
  name: string,
  kind: PlanLine['kind'],
  planned: number,
  actual: number,
): PlanLine {
  return {
    category_id: id,
    name,
    kind,
    planned_cents: planned,
    actual_cents: actual,
    remaining_cents: planned - actual,
    overspent: kind === 'expense' && actual > planned,
    is_sinking_fund: false,
    is_hidden: false,
    note: null,
    committed_cents: 0,
  }
}

function group(id: number, name: string, kind: PlanLine['kind'], lines: PlanLine[]) {
  const planned = lines.reduce((sum, row) => sum + row.planned_cents, 0)
  const actual = lines.reduce((sum, row) => sum + row.actual_cents, 0)
  return {
    id,
    name,
    kind,
    planned_cents: planned,
    actual_cents: actual,
    remaining_cents: planned - actual,
    lines,
  }
}

const VIEW: BudgetView = withPlanned(
  {
    period: {
      id: 5,
      start_date: '2026-01-02',
      end_date: '2026-01-15',
      schedule_id: 1,
      is_transition: false,
      days: 14,
    },
    previous_id: 4,
    next_id: 6,
    income: [group(1, 'Income', 'income', [line(1, 'Paycheck', 'income', 250_000, 0)])],
    expense: [
      group(2, 'Food', 'expense', [
        line(2, 'Groceries', 'expense', 40_000, 12_000),
        line(3, 'Dining', 'expense', 10_000, 4_000),
      ]),
    ],
    summary: {
      expected_income_cents: 0,
      received_income_cents: 0,
      planned_expense_cents: 0,
      left_to_plan_cents: 0,
      spent_cents: 0,
      remaining_cents: 0,
    },
    uncategorized_count: 2,
  },
  new Map(),
)

let calls: { method: string; url: string; body: unknown }[] = []
let failPuts = false

beforeEach(() => {
  calls = []
  failPuts = false
  let current = VIEW
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      const body = init.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method, url, body })
      if (method === 'PUT') {
        if (failPuts) {
          return new Response(JSON.stringify({ detail: 'Server said no.', code: 'boom' }), {
            status: 500,
          })
        }
        const categoryId = Number(url.split('/').pop())
        current = withPlanned(current, new Map([[categoryId, body.planned_cents]]))
      }
      return new Response(JSON.stringify(current), { status: 200 })
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
      <MemoryRouter initialEntries={['/budget/5']}>
        <ToastProvider>
          <Routes>
            <Route path="/budget/:periodId" element={<BudgetPage />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const planned = (name: string) => screen.getByLabelText(`Planned for ${name}`) as HTMLInputElement

describe('BudgetPage', () => {
  it('shows the summary and the uncategorized alert', async () => {
    renderPage()
    expect(await screen.findByTestId('left-to-plan')).toHaveProperty('textContent', '$2,000.00')
    expect(screen.getByTestId('remaining-total').textContent).toBe('$340.00')
    expect(screen.getByRole('alert').textContent).toContain('2 uncategorized transactions')
    expect(screen.getByRole('link', { name: 'Review' }).getAttribute('href')).toBe(
      '/transactions?from=2026-01-02&to=2026-01-15&uncategorized=1&on_budget=1',
    )
  })

  it('Enter commits, moves to the next category, and updates the totals at once', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('left-to-plan')

    await user.click(planned('Groceries'))
    expect(planned('Groceries').value).toBe('400.00')
    await user.keyboard('300{Enter}')

    expect(document.activeElement).toBe(planned('Dining'))
    // Optimistic: no waiting for the server.
    expect(screen.getByTestId('remaining-Groceries').textContent).toBe('$180.00')
    expect(screen.getByTestId('planned-total').textContent).toBe('$400.00')
    expect(screen.getByTestId('left-to-plan').textContent).toBe('$2,100.00')

    await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true))
    const put = calls.find((call) => call.method === 'PUT')!
    expect(put.url).toBe('/api/v1/budget/5/categories/2')
    expect(put.body).toEqual({ planned_cents: 30_000 })
  })

  it('Tab commits too, and takes amount math', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('left-to-plan')
    await user.click(planned('Dining'))
    await user.keyboard('20+15')
    await user.tab()
    expect(screen.getByTestId('remaining-Dining').textContent).toBe('-$5.00')
    expect(screen.getByTestId('line-Dining').getAttribute('data-overspent')).toBe('true')
    await waitFor(() =>
      expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({ planned_cents: 3500 }),
    )
  })

  it('Esc reverts the field without saving', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('left-to-plan')
    await user.click(planned('Dining'))
    await user.keyboard('999{Escape}')
    expect(planned('Dining').value).toBe('$100.00')
    expect(calls.some((call) => call.method === 'PUT')).toBe(false)
  })

  it('a refused save rolls back and says why', async () => {
    const user = userEvent.setup()
    failPuts = true
    renderPage()
    await screen.findByTestId('left-to-plan')
    await user.click(planned('Dining'))
    await user.keyboard('1{Enter}')
    expect(await screen.findByText('Server said no.')).toBeTruthy()
    expect(screen.getByTestId('remaining-Dining').textContent).toBe('$60.00')
    expect(screen.getByTestId('planned-total').textContent).toBe('$500.00')
  })
})
