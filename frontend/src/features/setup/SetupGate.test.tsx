// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppShell } from '../../components/AppShell'
import { ToastProvider } from '../../components/Toast'

let schedule: unknown = null
let accounts: unknown[] = []

beforeEach(() => {
  window.localStorage.clear()
  schedule = null
  accounts = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const json = (value: unknown) => new Response(JSON.stringify(value))
      if (url === '/api/v1/pay-schedule') return json({ current: schedule, history: [] })
      if (url === '/api/v1/accounts') return json({ items: accounts })
      if (url.startsWith('/api/v1/settings')) return json({ theme_default: 'system' })
      if (url.startsWith('/api/v1/auth')) return json(null)
      return json({ items: [] })
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<p>dashboard</p>} />
              <Route path="setup" element={<p>setup wizard</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('first-run setup', () => {
  it('sends a new household to the wizard', async () => {
    renderAt('/')
    expect(await screen.findByText('setup wizard')).toBeTruthy()
  })

  it('stays out of the way once skipped in this browser', async () => {
    window.localStorage.setItem('pb.setup.skipped', '1')
    renderAt('/')
    expect(await screen.findByText('dashboard')).toBeTruthy()
  })

  it('stays out of the way once there is a schedule and an account', async () => {
    schedule = { id: 1 }
    accounts = [{ id: 1, name: 'Checking' }]
    renderAt('/')
    expect(await screen.findByText('dashboard')).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByText('setup wizard')).toBeNull()
  })
})
