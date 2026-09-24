import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { fetchDashboard } from '../../api/budget'
import type { BudgetView } from '../../api/budget'
import { ApiRequestError } from '../../api/client'
import { queryKeys } from '../../api/keys'
import { formatCents } from '../../lib/money'
import { TRANSFER_PREFIX } from '../ledger/draft'
import { useReferenceData } from '../ledger/useLedgerData'

function Card({
  title,
  children,
  action,
}: {
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <section className="rounded border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Amount({ cents, bad = cents < 0 }: { cents: number; bad?: boolean }) {
  return <span className={`tabular-nums ${bad ? 'text-rose-600' : ''}`}>{formatCents(cents)}</span>
}

function PeriodSummary({ budget }: { budget: BudgetView | null }) {
  if (budget === null) {
    return (
      <Card title="This pay period">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Set up your{' '}
          <Link to="/settings/pay-schedule" className="text-sky-600 underline">
            pay schedule
          </Link>{' '}
          to budget by pay period.
        </p>
      </Card>
    )
  }
  const { summary, period } = budget
  const rows: [string, number, boolean][] = [
    ['Expected income', summary.expected_income_cents, false],
    ['Received', summary.received_income_cents, false],
    ['Planned', summary.planned_expense_cents, false],
    ['Spent', summary.spent_cents, false],
    ['Remaining', summary.remaining_cents, summary.remaining_cents < 0],
    ['Left to plan', summary.left_to_plan_cents, summary.left_to_plan_cents < 0],
  ]
  return (
    <Card
      title={`This pay period · ${period.start_date} – ${period.end_date}`}
      action={
        <Link to="/budget" className="text-xs text-sky-600 underline">
          Open budget
        </Link>
      }
    >
      <dl
        className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3"
        data-testid="dashboard-summary"
      >
        {rows.map(([label, cents, bad]) => (
          <div key={label} className="flex justify-between gap-2">
            <dt className="text-slate-500">{label}</dt>
            <dd className="font-medium">
              <Amount cents={cents} bad={bad} />
            </dd>
          </div>
        ))}
      </dl>
      {budget.uncategorized_count > 0 && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          {budget.uncategorized_count} uncategorized{' '}
          {budget.uncategorized_count === 1 ? 'transaction' : 'transactions'} this period.
        </p>
      )}
    </Card>
  )
}

/** The dashboard: the current pay period at a glance (BUILD_PLAN Phase 6). */
export function DashboardPage() {
  const reference = useReferenceData()
  const board = useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: ({ signal }) => fetchDashboard(signal),
  })

  if (board.isPending) return <p className="text-sm text-slate-500">Loading…</p>
  if (board.isError) {
    return (
      <p className="text-sm text-rose-600">
        {board.error instanceof ApiRequestError
          ? board.error.detail
          : 'The dashboard could not load.'}
      </p>
    )
  }

  const data = board.data
  const accountName = (id: number | null) =>
    reference.accounts.find((account) => account.id === id)?.name ?? ''
  const payeeName = (id: number | null) =>
    reference.payees.find((payee) => payee.id === id)?.name ?? ''

  return (
    <div className="max-w-5xl">
      <h1 className="mb-4 text-xl font-semibold">Dashboard</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <PeriodSummary budget={data.budget} />
        </div>

        <Card title="Most overspent">
          {data.overspent.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing is overspent this period.</p>
          ) : (
            <ul className="space-y-1 text-sm" data-testid="overspent-list">
              {data.overspent.map((row) => (
                <li key={row.category_id} className="flex justify-between gap-3">
                  <span className="truncate">
                    {row.name} <span className="text-xs text-slate-400">{row.group_name}</span>
                  </span>
                  <span className="shrink-0 text-rose-600 tabular-nums">
                    {formatCents(row.over_cents)} over
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Account balances">
          {data.balances.length === 0 ? (
            <p className="text-sm text-slate-500">
              No accounts yet.{' '}
              <Link to="/accounts" className="text-sky-600 underline">
                Add one
              </Link>
              .
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {data.balances.map((balance) => (
                <li key={balance.account_id} className="flex justify-between gap-3">
                  <Link
                    to={`/transactions/${balance.account_id}`}
                    className="truncate hover:underline"
                  >
                    {accountName(balance.account_id)}
                  </Link>
                  <Amount cents={balance.current_cents} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Recent transactions"
          action={
            <Link to="/transactions" className="text-xs text-sky-600 underline">
              Ledger
            </Link>
          }
        >
          {data.recent.length === 0 ? (
            <p className="text-sm text-slate-500">No transactions yet.</p>
          ) : (
            <ul className="space-y-1 text-sm" data-testid="recent-list">
              {data.recent.map((tx) => (
                <li key={tx.id} className="grid grid-cols-[5.5rem_1fr_auto] gap-2">
                  <span className="text-slate-500 tabular-nums">{tx.date}</span>
                  <span className="truncate">
                    {tx.transfer_account_id !== null
                      ? `${TRANSFER_PREFIX}${accountName(tx.transfer_account_id)}`
                      : payeeName(tx.payee_id) || '—'}
                    <span className="ml-1.5 text-xs text-slate-400">
                      {accountName(tx.account_id)}
                    </span>
                  </span>
                  <span
                    className={`tabular-nums ${tx.amount_cents > 0 ? 'text-emerald-700 dark:text-emerald-400' : ''}`}
                  >
                    {formatCents(tx.amount_cents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Upcoming bills">
          <p className="text-sm text-slate-500">
            Bills due this period and next will show here once subscriptions are set up.
          </p>
        </Card>
      </div>
    </div>
  )
}
