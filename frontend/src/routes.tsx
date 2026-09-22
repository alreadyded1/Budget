import { Route, Routes } from 'react-router-dom'

import { AppShell } from './components/AppShell'
import { NotFoundPage } from './features/NotFoundPage'
import { AccountsPage } from './features/accounts/AccountsPage'
import { BudgetPage } from './features/budget/BudgetPage'
import { CalendarPage } from './features/calendar/CalendarPage'
import { DashboardPage } from './features/dashboard/DashboardPage'
import { LedgerPage } from './features/ledger/LedgerPage'
import { PayeesPage } from './features/payees/PayeesPage'
import { ReportsPage } from './features/reports/ReportsPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { SubscriptionsPage } from './features/subscriptions/SubscriptionsPage'

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="budget" element={<BudgetPage />} />
        <Route path="transactions" element={<LedgerPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="subscriptions" element={<SubscriptionsPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="payees" element={<PayeesPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
