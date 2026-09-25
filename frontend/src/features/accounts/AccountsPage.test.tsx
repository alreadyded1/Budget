// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '../../components/Toast'
import type { Account } from '../../api/accounts'
import { AccountsPage } from './AccountsPage'

let posted: Record<string, unknown>[] = []
let patched: Record<string, unknown>[] = []
let accounts: Account[] = []
let balances: { account_id: number; current_cents: number }[] = []

function account(fields: Partial<Account>): Account {
  return {
    id: 1,
    name: 'Visa',
    type: 'credit_card',
    on_budget: true,
    opening_balance_cents: 0,
    opening_date: '2026-01-01',
    institution: null,
    last4: null,
    sort_order: 0,
    is_closed: false,
    valuation_mode: 'transactions',
    apr_bps: null,
    min_payment_cents: null,
    payment_due_day: null,
    low_balance_alert_cents: null,
    is_liability: true,
    ...fields,
  }
}

beforeEach(() => {
  posted = []
  patched = []
  accounts = []
  balances = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
      const body = () => JSON.parse(String(init?.body)) as Record<string, unknown>
      if (url === '/api/v1/accounts' && init?.method === 'POST') {
        posted.push(body())
        return json({ id: 9, is_liability: true, ...body() }, 201)
      }
      if (url.startsWith('/api/v1/accounts/') && init?.method === 'PATCH') {
        patched.push(body())
        return json({ ...accounts[0], ...body() })
      }
      if (url === '/api/v1/accounts') return json({ items: accounts })
      if (url === '/api/v1/balances') return json({ items: balances })
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
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <AccountsPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('adding an account (repair list #1)', () => {
  it('takes the APR and minimum payment for a debt, from the keyboard', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(await screen.findByLabelText('Account name'), 'Visa')
    await user.selectOptions(screen.getByLabelText('Account type'), 'credit_card')
    await user.tab() // → opening balance
    await user.tab() // → APR
    expect(screen.getByLabelText('APR')).toBe(document.activeElement)
    await user.keyboard('24.99')
    await user.tab()
    await user.keyboard('35{Enter}')
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({
      name: 'Visa',
      type: 'credit_card',
      apr_bps: 2499,
      min_payment_cents: 3500,
    })
  })

  it('leaves them out for other account types', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(await screen.findByLabelText('Account name'), 'Checking')
    expect(screen.queryByLabelText('APR')).toBeNull()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).not.toHaveProperty('apr_bps')
    expect(posted[0]).not.toHaveProperty('min_payment_cents')
  })

  it('refuses an APR that is not a percent', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(await screen.findByLabelText('Account name'), 'Car loan')
    await user.selectOptions(screen.getByLabelText('Account type'), 'loan')
    await user.type(screen.getByLabelText('APR'), 'lots{Enter}')
    expect(await screen.findByText('Type the APR as a percent, e.g. 19.99.')).toBeTruthy()
    expect(posted).toHaveLength(0)
  })
})

describe('debts are entered and shown as amounts owed (repair list)', () => {
  it('stores a typed amount owed as money owed, whatever its sign', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(await screen.findByLabelText('Account name'), 'Visa')
    await user.selectOptions(screen.getByLabelText('Account type'), 'credit_card')
    expect(screen.queryByLabelText('Opening balance')).toBeNull()
    await user.type(screen.getByLabelText('Amount owed'), '2,450.00{Enter}')
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ opening_balance_cents: -245_000 })

    await user.type(screen.getByLabelText('Account name'), 'Car loan')
    await user.selectOptions(screen.getByLabelText('Account type'), 'loan')
    await user.type(screen.getByLabelText('Amount owed'), '-12000{Enter}')
    await waitFor(() => expect(posted).toHaveLength(2))
    expect(posted[1]).toMatchObject({ opening_balance_cents: -1_200_000 })
  })

  it('keeps the sign as typed for everything else', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(await screen.findByLabelText('Account name'), 'Checking')
    await user.type(screen.getByLabelText('Opening balance'), '-25.50{Enter}')
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ opening_balance_cents: -2_550 })
  })

  it('shows a debt as owed, and an overpaid one as in credit', async () => {
    accounts = [account({ id: 1, name: 'Visa' }), account({ id: 2, name: 'Amex' })]
    balances = [
      { account_id: 1, current_cents: -245_000 },
      { account_id: 2, current_cents: 1_500 },
    ]
    renderPage()
    const visa = (await screen.findByRole('link', { name: 'Visa' })).closest('li')!
    await waitFor(() => expect(visa.textContent).toContain('$2,450.00owed'))
    const amex = screen.getByRole('link', { name: 'Amex' }).closest('li')!
    expect(amex.textContent).toContain('$15.00in credit')
  })

  it('corrects an opening balance entered with the wrong sign, from the keyboard', async () => {
    accounts = [account({ opening_balance_cents: 245_000 })]
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Edit opening balance for Visa' }))
    const owed = screen.getByLabelText('Amount owed at opening')
    expect(document.activeElement).toBe(owed)
    expect((owed as HTMLInputElement).value).toBe('2450.00')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(patched).toHaveLength(1))
    expect(patched[0]).toEqual({ opening_balance_cents: -245_000, opening_date: '2026-01-01' })
    await waitFor(() => expect(screen.queryByLabelText('Amount owed at opening')).toBeNull())
  })

  it('Esc closes the correction without saving', async () => {
    accounts = [account({ type: 'checking', is_liability: false, opening_balance_cents: 5_000 })]
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Edit opening balance for Visa' }))
    const panel = screen.getByRole('form', { name: 'Opening balance for Visa' })
    expect(document.activeElement).toBe(within(panel).getByLabelText('Opening balance'))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('form', { name: 'Opening balance for Visa' })).toBeNull()
    expect(patched).toHaveLength(0)
  })
})
