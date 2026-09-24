import { NavLink, Outlet } from 'react-router-dom'

import { UserMenu } from '../features/auth/UserMenu'
import { HealthBadge } from './HealthBadge'

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/budget', label: 'Budget' },
  { to: '/goals', label: 'Goals' },
  { to: '/transactions', label: 'Transactions' },
  { to: '/accounts', label: 'Accounts' },
  { to: '/subscriptions', label: 'Subscriptions' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/reports', label: 'Reports' },
  { to: '/payees', label: 'Payees' },
  { to: '/settings', label: 'Settings' },
]

export function AppShell() {
  return (
    <div className="flex h-full bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="px-2 py-3 text-sm font-semibold tracking-tight">Payday Budget</div>
        <nav className="flex flex-1 flex-col gap-0.5">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                [
                  'rounded px-2 py-1.5 text-sm outline-none',
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
        <div className="border-t border-slate-200 px-2 pt-3 dark:border-slate-800">
          <UserMenu />
          <div className="mt-2">
            <HealthBadge />
          </div>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}
