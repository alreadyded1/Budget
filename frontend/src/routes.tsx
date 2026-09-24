import { Route, Routes } from 'react-router-dom'

import { AppShell } from './components/AppShell'
import { NotFoundPage } from './features/NotFoundPage'
import { AccountsPage } from './features/accounts/AccountsPage'
import { LoginPage } from './features/auth/LoginPage'
import { RequireSession } from './features/auth/RequireSession'
import { BudgetPage } from './features/budget/BudgetPage'
import { CalendarPage } from './features/calendar/CalendarPage'
import { CategoriesPage } from './features/categories/CategoriesPage'
import { DashboardPage } from './features/dashboard/DashboardPage'
import { ImportPage } from './features/import/ImportPage'
import { LedgerPage } from './features/ledger/LedgerPage'
import { PayeesPage } from './features/payees/PayeesPage'
import { ReportsPage } from './features/reports/ReportsPage'
import { GeneralSettingsPage } from './features/settings/GeneralSettingsPage'
import { NotificationsSettingsPage } from './features/settings/NotificationsSettingsPage'
import { PayPeriodsPage } from './features/settings/PayPeriodsPage'
import { PayScheduleSettingsPage } from './features/settings/PayScheduleSettingsPage'
import { RulesSettingsPage } from './features/settings/RulesSettingsPage'
import { SettingsLayout } from './features/settings/SettingsLayout'
import { UsersSettingsPage } from './features/settings/UsersSettingsPage'
import { SubscriptionsPage } from './features/subscriptions/SubscriptionsPage'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireSession>
            <AppShell />
          </RequireSession>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="budget" element={<BudgetPage />} />
        <Route path="budget/:periodId" element={<BudgetPage />} />
        <Route path="transactions" element={<LedgerPage />} />
        <Route path="transactions/:accountId" element={<LedgerPage />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="import/:accountId" element={<ImportPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="subscriptions" element={<SubscriptionsPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="payees" element={<PayeesPage />} />
        <Route path="settings" element={<SettingsLayout />}>
          <Route index element={<GeneralSettingsPage />} />
          <Route path="pay-schedule" element={<PayScheduleSettingsPage />} />
          <Route path="pay-periods" element={<PayPeriodsPage />} />
          <Route path="categories" element={<CategoriesPage />} />
          <Route path="rules" element={<RulesSettingsPage />} />
          <Route path="notifications" element={<NotificationsSettingsPage />} />
          <Route path="users" element={<UsersSettingsPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
