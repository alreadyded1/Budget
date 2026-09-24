// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '../../components/Toast'
import { ReconcilePage } from './ReconcilePage'

const ACCOUNTS = [
  {
    id: 1,
    name: 'Checking',
    is_liability: false,
    valuation_mode: 'transactions',
    is_closed: false,
  },
  { id: 2, name: 'Visa', is_liability: true, valuation_mode: 'transactions', is_closed: false },
]

function row(id: number, amount_cents: number, status: string, account_id = 1) {
  return {
    id,
    account_id,
    date: '2026-09-02',
    payee_id: null,
    memo: `row ${id}`,
    amount_cents,
    status,
    check_number: null,
    transfer_id: null,
    transfer_account_id: null,
    splits: [],
  }
}

let calls: { method: string; url: string; body: unknown }[] = []
let rows: ReturnType<typeof row>[] = []

beforeEach(() => {
  calls = []
  window.localStorage.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      const body = init.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method, url, body })
      const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
      if (url === '/api/v1/accounts') return json({ items: ACCOUNTS })
      if (url.includes('/reconcile?')) {
        const accountId = Number(url.split('/')[4])
        return json({
          account_id: accountId,
          is_liability: accountId === 2,
          statement_date: '2026-09-30',
          reconciled_cents: accountId === 2 ? 0 : 100000,
          ticked_cents: 0,
          rows: rows.filter((item) => item.account_id === accountId),
          last: null,
        })
      }
      if (url.startsWith('/api/v1/transactions/') && method === 'PATCH') {
        const id = Number(url.split('/').pop())
        rows = rows.map((item) => (item.id === id ? { ...item, ...body } : item))
        return json({ transactions: rows.filter((item) => item.id === id), balances: [] })
      }
      if (url.endsWith('/reconciliations') && method === 'POST') {
        return json(
          {
            reconciliation: {
              id: 9,
              account_id: 1,
              statement_date: body.statement_date,
              statement_balance_cents: body.statement_balance_cents,
              adjustment_transaction_id: null,
              adjustment_cents: null,
              transaction_count: 2,
              completed_by: 1,
              completed_at: '2026-09-30T12:00:00Z',
            },
            balances: [],
          },
          201,
        )
      }
      if (url.startsWith('/api/v1/settings')) return json({})
      return json({ items: [] })
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderPage(accountId: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/reconcile/${accountId}`]}>
          <Routes>
            <Route path="/reconcile/:accountId" element={<ReconcilePage />} />
            <Route path="/transactions/:accountId" element={<p>ledger</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

async function startStatement(user: ReturnType<typeof userEvent.setup>, balance: string) {
  const date = await screen.findByLabelText('Statement date')
  await user.clear(date)
  await user.type(date, '2026-09-30')
  await user.type(screen.getByLabelText('Statement balance'), `${balance}{Enter}`)
}

describe('ReconcilePage', () => {
  it('blocks Finish until the ticks match, then finishes', async () => {
    rows = [row(1, -4520, 'cleared'), row(2, 250000, 'uncleared'), row(3, -100, 'uncleared')]
    const user = userEvent.setup()
    renderPage(1)
    await startStatement(user, '3454.80')

    const difference = await screen.findByTestId('reconcile-difference')
    expect(difference.textContent).toBe('$2,500.00')
    expect(screen.getByRole('button', { name: 'Finish' })).toHaveProperty('disabled', true)

    // The first checkbox has focus; ↓ moves to the payroll row and Space ticks it.
    await user.keyboard('{ArrowDown} ')
    await waitFor(() => expect(difference.textContent).toBe('$0.00'))
    expect(calls.find((call) => call.method === 'PATCH')).toMatchObject({
      url: '/api/v1/transactions/2',
      body: { status: 'cleared' },
    })

    await user.click(screen.getByRole('button', { name: 'Finish' }))
    await screen.findByText('ledger')
    expect(
      calls.find(
        (call) => call.url === '/api/v1/accounts/1/reconciliations' && call.method === 'POST',
      )?.body,
    ).toEqual({
      statement_date: '2026-09-30',
      statement_balance_cents: 345480,
      adjust: false,
      adjustment_category_id: null,
    })
  })

  it('takes a card statement as money owed and offers an adjustment', async () => {
    rows = [row(4, -8910, 'cleared', 2)]
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    renderPage(2)
    expect(await screen.findByText('Amount owed on the statement')).toBeTruthy()
    await startStatement(user, '90.00')

    // Owes $90.00, ticked $89.10: $0.90 more owed than the ledger shows.
    const difference = await screen.findByTestId('reconcile-difference')
    expect(difference.textContent).toBe('-$0.90')
    await user.click(screen.getByRole('button', { name: 'Finish with a -$0.90 adjustment' }))

    await screen.findByText('ledger')
    expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({
      statement_balance_cents: -9000,
      adjust: true,
    })
  })

  it('remembers the statement when you come back', async () => {
    rows = []
    const user = userEvent.setup()
    const first = renderPage(1)
    await startStatement(user, '1000')
    await screen.findByTestId('worksheet')
    first.unmount()

    renderPage(1)
    const worksheet = await screen.findByTestId('worksheet')
    expect(worksheet.textContent).toContain('Statement of 2026-09-30: $1,000.00')
  })
})
