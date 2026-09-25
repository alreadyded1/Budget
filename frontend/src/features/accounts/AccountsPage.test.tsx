// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '../../components/Toast'
import { AccountsPage } from './AccountsPage'

let posted: Record<string, unknown>[] = []

beforeEach(() => {
  posted = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
      if (url === '/api/v1/accounts' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        posted.push(body)
        return json({ id: 9, is_liability: true, ...body }, 201)
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
