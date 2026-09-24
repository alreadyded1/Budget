// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '../../components/Toast'
import ReportsPage from './ReportsPage'

let urls: string[] = []

const SPENDING = {
  start: '2026-08-01',
  end: '2026-08-31',
  total_cents: 14_020,
  items: [
    {
      category_id: 3,
      name: 'Groceries',
      group_id: 1,
      group_name: 'Living',
      total_cents: 10_020,
      share_bp: 7_147,
      count: 3,
    },
    {
      category_id: null,
      name: 'Uncategorized',
      group_id: null,
      group_name: 'Uncategorized',
      total_cents: 4_000,
      share_bp: 2_853,
      count: 1,
    },
  ],
}

beforeEach(() => {
  urls = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url)
      const json = (value: unknown) => new Response(JSON.stringify(value))
      if (url.startsWith('/api/v1/reports/range'))
        return json({ start: '2026-08-01', end: '2026-08-31' })
      if (url.startsWith('/api/v1/reports/spending-by-category')) return json(SPENDING)
      if (url.startsWith('/api/v1/accounts'))
        return json({
          items: [
            { id: 1, name: 'Checking', is_closed: false },
            { id: 2, name: 'Visa', is_closed: false },
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

function Where() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname + location.search}</output>
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/reports/:report" element={<ReportsPage />} />
          </Routes>
          <Where />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('ReportsPage', () => {
  it('shows spending with drill-down links to exact dates', async () => {
    renderAt('/reports/spending?preset=last_month')
    const table = await screen.findByTestId('spending-by-category-table')
    expect(within(table).getByText('$100.20')).toBeTruthy()
    expect(within(table).getByText('71.5%')).toBeTruthy()
    expect(screen.getByTestId('report-range').textContent).toBe('2026-08-01 to 2026-08-31')
    expect(within(table).getByRole('link', { name: 'Groceries' }).getAttribute('href')).toBe(
      '/reports/transactions?preset=custom&from=2026-08-01&to=2026-08-31&category=3&on_budget=1',
    )
    expect(
      within(table).getByRole('link', { name: 'Uncategorized' }).getAttribute('href'),
    ).toContain('uncategorized=1&on_budget=1&flow=out')
    expect(
      urls.some((url) => url === '/api/v1/reports/spending-by-category?preset=last_month'),
    ).toBe(true)
  })

  it('exports the table as CSV', async () => {
    const user = userEvent.setup()
    let blob: Blob | undefined
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (value: Blob) => {
        blob = value
        return 'blob:x'
      },
      revokeObjectURL: () => {},
    })
    const clicks: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this.download)
    })
    renderAt('/reports/spending?preset=last_month')
    await screen.findByTestId('spending-by-category-table')
    await user.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(clicks).toEqual(['spending-by-category_2026-08-01_2026-08-31.csv'])
    expect(await blob?.text()).toBe(
      'Category,Group,Transactions,Spent,% of total\r\n' +
        'Groceries,Living,3,100.20,71.5\r\n' +
        'Uncategorized,Uncategorized,1,40.00,28.5\r\n',
    )
  })

  it('puts filters in the URL and sends them to the API', async () => {
    const user = userEvent.setup()
    renderAt('/reports/spending?preset=last_month')
    await screen.findByTestId('spending-by-category-table')
    await user.click(screen.getByRole('button', { name: 'Accounts: All' }))
    await user.click(screen.getByRole('checkbox', { name: 'Visa' }))
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/reports/spending?preset=last_month&account=2',
      ),
    )
    await waitFor(() =>
      expect(urls).toContain('/api/v1/reports/spending-by-category?preset=last_month&account_id=2'),
    )
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Accounts: Visa' })).toBe(document.activeElement)
  })

  it('asks for categories before drawing a trend', async () => {
    renderAt('/reports/trend?preset=year_to_date')
    expect(await screen.findByText(/Pick one or more categories/)).toBeTruthy()
    expect(urls.some((url) => url.includes('category-trend'))).toBe(false)
  })
})
