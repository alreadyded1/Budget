import { useState } from 'react'
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'

import { UserMenu } from '../features/auth/UserMenu'
import { ErrorBoundary } from './ErrorBoundary'
import { setupSkipped, useSetupStatus } from '../features/setup/useSetup'
import { HealthBadge } from './HealthBadge'

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/budget', label: 'Budget' },
  { to: '/goals', label: 'Goals' },
  { to: '/debt', label: 'Debt payoff' },
  { to: '/transactions', label: 'Transactions' },
  { to: '/accounts', label: 'Accounts' },
  { to: '/subscriptions', label: 'Bills & Recurring' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/reports', label: 'Reports' },
  { to: '/payees', label: 'Payees' },
  { to: '/settings', label: 'Settings' },
]

export function AppShell() {
  const location = useLocation()
  // The phone menu is open on the page it was opened on; moving to another page closes it.
  const [openOn, setOpenOn] = useState<string | null>(null)
  const menuOpen = openOn === location.pathname
  const setup = useSetupStatus()
  // First run: straight to the wizard until it is done or skipped (D-106).
  if (
    setup.needed &&
    !setupSkipped() &&
    location.pathname !== '/setup' &&
    !location.pathname.startsWith('/settings')
  ) {
    return <Navigate to="/setup" replace />
  }

  return (
    <div className="flex h-full flex-col bg-slate-50 text-slate-900 md:flex-row dark:bg-slate-950 dark:text-slate-100">
      <a
        href="#main"
        className="sr-only z-50 rounded bg-white px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:top-2 focus:left-2 dark:bg-slate-900"
      >
        Skip to content
      </a>
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2 md:hidden dark:border-slate-800 dark:bg-slate-900">
        <span className="text-sm font-semibold tracking-tight">Payday Budget</span>
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-controls="app-menu"
          onClick={() => setOpenOn(menuOpen ? null : location.pathname)}
          className="rounded px-3 py-2 text-sm outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 dark:hover:bg-slate-800"
        >
          {menuOpen ? 'Close' : 'Menu'}
        </button>
      </header>
      <aside
        id="app-menu"
        aria-label="Main menu"
        className={[
          'shrink-0 flex-col border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900',
          'md:flex md:w-56 md:border-r',
          menuOpen ? 'flex border-b' : 'hidden',
        ].join(' ')}
      >
        <div className="hidden px-2 py-3 text-sm font-semibold tracking-tight md:block">
          Payday Budget
        </div>
        <nav className="flex flex-1 flex-col gap-0.5" aria-label="Main">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                [
                  'rounded px-2 py-2 text-sm outline-none md:py-1.5',
                  'focus-visible:ring-2 focus-visible:ring-sky-500',
                  isActive
                    ? 'bg-slate-100 font-medium dark:bg-slate-800'
                    : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60',
                ].join(' ')
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-2 border-t border-slate-200 px-2 pt-3 dark:border-slate-800">
          <UserMenu />
          <div className="mt-2">
            <HealthBadge />
          </div>
        </div>
      </aside>
      <main
        id="main"
        tabIndex={-1}
        className="min-w-0 flex-1 overflow-auto p-3 outline-none sm:p-6"
      >
        <ErrorBoundary resetKey={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  )
}
