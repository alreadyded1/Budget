import { NavLink, Outlet } from 'react-router-dom'

const TABS = [
  { to: '/settings', label: 'General', end: true },
  { to: '/settings/pay-schedule', label: 'Pay schedule' },
  { to: '/settings/pay-periods', label: 'Pay periods' },
  { to: '/settings/categories', label: 'Categories' },
  { to: '/settings/rules', label: 'Rules' },
  { to: '/settings/notifications', label: 'Notifications' },
  { to: '/settings/users', label: 'Users' },
]

export function SettingsLayout() {
  return (
    <section>
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <nav className="mt-4 flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              [
                '-mb-px border-b-2 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500',
                isActive
                  ? 'border-slate-900 font-medium text-slate-900 dark:border-slate-100 dark:text-slate-100'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200',
              ].join(' ')
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-6 max-w-3xl">
        <Outlet />
      </div>
    </section>
  )
}
