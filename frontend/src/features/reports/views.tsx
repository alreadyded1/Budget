import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { ApiRequestError } from '../../api/client'
import { queryKeys } from '../../api/keys'
import { fetchNetWorth } from '../../api/netWorth'
import { reportsApi } from '../../api/reports'
import type { ReportQuery } from '../../api/reports'
import { formatCents } from '../../lib/money'
import { GroupedBars, HorizontalBars, Lines } from './charts'
import { centsCsv, percentCsv } from './csv'
import { drillDownSearch } from './query'
import { ReportTable } from './ReportTable'

export type ReportContext = {
  query: ReportQuery
  /** The API query string for these filters. */
  qs: string
  /** Extra URL parameters (the transaction list's drill-down flags). */
  search: URLSearchParams
  names: {
    account: (id: number) => string
    payee: (id: number | null) => string
    category: (id: number | null) => string
  }
}

const LINK = 'text-sky-700 underline-offset-2 hover:underline dark:text-sky-300'

function percent(bp: number | null): string {
  return bp === null ? '—' : `${percentCsv(bp)}%`
}

function money(cents: number): ReactNode {
  return <span className={cents < 0 ? 'text-rose-600' : ''}>{formatCents(cents)}</span>
}

function Loading({ error }: { error: unknown }) {
  if (error)
    return (
      <p className="mt-6 text-sm text-rose-600">
        {error instanceof ApiRequestError ? error.detail : 'This report could not be loaded.'}
      </p>
    )
  return <p className="mt-6 text-sm text-slate-500">Loading…</p>
}

function Heading({ children }: { children: ReactNode }) {
  return <h2 className="mt-6 text-lg font-semibold">{children}</h2>
}

function TotalRow({ label, cells }: { label: string; cells: ReactNode[] }) {
  return (
    <tr className="border-t border-slate-300 dark:border-slate-700">
      <td className="py-1 pr-3">{label}</td>
      {cells.map((cell, index) => (
        <td key={index} className="py-1 pr-3 text-right tabular-nums">
          {cell}
        </td>
      ))}
    </tr>
  )
}

// ------------------------------------------------------------------- spending by category

export function SpendingByCategoryReport({ query, qs }: ReportContext) {
  const report = useQuery({
    queryKey: queryKeys.report('spending-by-category', qs),
    queryFn: ({ signal }) => reportsApi.spendingByCategory(qs, signal),
  })
  const data = report.data
  if (!data) return <Loading error={report.error} />
  const range = { start: data.start, end: data.end }
  return (
    <section>
      <Heading>Spending by category</Heading>
      <p className="text-sm text-slate-500">
        On-budget accounts; refunds lower a category, transfers between your accounts are left out.
      </p>
      {data.items.length > 0 && (
        <div className="mt-4">
          <HorizontalBars
            name="Spending by category"
            rows={data.items
              .slice(0, 12)
              .map((row) => ({ label: row.name, value: row.total_cents }))}
          />
        </div>
      )}
      <ReportTable
        report="spending-by-category"
        range={range}
        rows={data.items}
        rowKey={(row) => row.category_id ?? 'none'}
        columns={[
          {
            header: 'Category',
            cell: (row) => (
              <Link
                className={LINK}
                to={`/reports/transactions?${drillDownSearch(query, range, { categoryId: row.category_id })}`}
              >
                {row.name}
              </Link>
            ),
            csv: (row) => row.name,
          },
          { header: 'Group', cell: (row) => row.group_name, csv: (row) => row.group_name },
          {
            header: 'Transactions',
            cell: (row) => row.count,
            csv: (row) => row.count,
            align: 'right',
          },
          {
            header: 'Spent',
            cell: (row) => money(row.total_cents),
            csv: (row) => centsCsv(row.total_cents),
            align: 'right',
          },
          {
            header: '% of total',
            cell: (row) => percent(row.share_bp),
            csv: (row) => percentCsv(row.share_bp),
            align: 'right',
          },
        ]}
        footer={<TotalRow label="Total" cells={['', '', formatCents(data.total_cents), '100%']} />}
      />
    </section>
  )
}

// ---------------------------------------------------------------------- spending by payee

export function SpendingByPayeeReport({ query, qs }: ReportContext) {
  const report = useQuery({
    queryKey: queryKeys.report('spending-by-payee', qs),
    queryFn: ({ signal }) => reportsApi.spendingByPayee(qs, signal),
  })
  const data = report.data
  if (!data) return <Loading error={report.error} />
  const range = { start: data.start, end: data.end }
  return (
    <section>
      <Heading>Spending by payee</Heading>
      {data.items.length > 0 && (
        <div className="mt-4">
          <HorizontalBars
            name="Top payees"
            rows={data.items
              .slice(0, 15)
              .map((row) => ({ label: row.name, value: row.total_cents }))}
          />
        </div>
      )}
      <ReportTable
        report="spending-by-payee"
        range={range}
        rows={data.items}
        rowKey={(row) => row.payee_id ?? 'none'}
        columns={[
          {
            header: 'Payee',
            cell: (row) =>
              row.payee_id === null ? (
                row.name
              ) : (
                <Link
                  className={LINK}
                  to={`/reports/transactions?${drillDownSearch(query, range, { payeeId: row.payee_id })}`}
                >
                  {row.name}
                </Link>
              ),
            csv: (row) => row.name,
          },
          {
            header: 'Transactions',
            cell: (row) => row.count,
            csv: (row) => row.count,
            align: 'right',
          },
          {
            header: 'Spent',
            cell: (row) => money(row.total_cents),
            csv: (row) => centsCsv(row.total_cents),
            align: 'right',
          },
          {
            header: '% of total',
            cell: (row) => percent(row.share_bp),
            csv: (row) => percentCsv(row.share_bp),
            align: 'right',
          },
        ]}
        footer={<TotalRow label="Total" cells={['', formatCents(data.total_cents), '100%']} />}
      />
    </section>
  )
}

// ---------------------------------------------------------------------- income vs expense

export function IncomeVsExpenseReport({ qs, search }: ReportContext) {
  const by = search.get('by') === 'period' ? 'period' : 'month'
  const full = `${qs}&by=${by}`
  const report = useQuery({
    queryKey: queryKeys.report('income-vs-expense', full),
    queryFn: ({ signal }) => reportsApi.incomeVsExpense(full, signal),
  })
  const data = report.data
  const toggle = new URLSearchParams(search)
  toggle.set('by', by === 'month' ? 'period' : 'month')
  if (!data) return <Loading error={report.error} />
  return (
    <section>
      <div className="flex items-baseline justify-between">
        <Heading>Income vs. expense</Heading>
        <Link className={`${LINK} no-print text-sm`} to={`?${toggle.toString()}`} replace>
          {by === 'month' ? 'By pay period' : 'By month'}
        </Link>
      </div>
      <div className="mt-2 flex flex-wrap gap-6 text-sm" data-testid="income-summary">
        <span>
          Income <strong className="tabular-nums">{formatCents(data.total.income_cents)}</strong>
        </span>
        <span>
          Spending{' '}
          <strong className="tabular-nums">{formatCents(data.total.spending_cents)}</strong>
        </span>
        <span>
          Net <strong className="tabular-nums">{formatCents(data.total.net_cents)}</strong>
        </span>
        <span>
          Savings rate{' '}
          <strong className="tabular-nums">{percent(data.total.savings_rate_bp)}</strong>
        </span>
      </div>
      {data.buckets.length > 0 && (
        <div className="mt-4">
          <GroupedBars
            name="Income and spending"
            rows={data.buckets.map((b) => ({
              label: b.label,
              income: b.income_cents,
              spending: b.spending_cents,
            }))}
            series={[
              { key: 'income', name: 'Income', slot: 0 },
              { key: 'spending', name: 'Spending', slot: 1 },
            ]}
          />
        </div>
      )}
      <ReportTable
        report="income-vs-expense"
        range={{ start: data.start, end: data.end }}
        rows={data.buckets}
        rowKey={(row) => row.start}
        columns={[
          {
            header: by === 'month' ? 'Month' : 'Pay period',
            cell: (row) => row.label,
            csv: (row) => row.label,
          },
          {
            header: 'Income',
            cell: (row) => money(row.income_cents),
            csv: (row) => centsCsv(row.income_cents),
            align: 'right',
          },
          {
            header: 'Spending',
            cell: (row) => money(row.spending_cents),
            csv: (row) => centsCsv(row.spending_cents),
            align: 'right',
          },
          {
            header: 'Net',
            cell: (row) => money(row.net_cents),
            csv: (row) => centsCsv(row.net_cents),
            align: 'right',
          },
          {
            header: 'Savings rate',
            cell: (row) => percent(row.savings_rate_bp),
            csv: (row) => percentCsv(row.savings_rate_bp),
            align: 'right',
          },
        ]}
        footer={
          <TotalRow
            label="Total"
            cells={[
              formatCents(data.total.income_cents),
              formatCents(data.total.spending_cents),
              formatCents(data.total.net_cents),
              percent(data.total.savings_rate_bp),
            ]}
          />
        }
      />
    </section>
  )
}

// ---------------------------------------------------------------------- planned vs actual

export function PlannedVsActualReport({ qs }: ReportContext) {
  const report = useQuery({
    queryKey: queryKeys.report('planned-vs-actual', qs),
    queryFn: ({ signal }) => reportsApi.plannedVsActual(qs, signal),
  })
  const data = report.data
  if (!data) return <Loading error={report.error} />
  const range = { start: data.start, end: data.end }
  return (
    <section>
      <Heading>Planned vs. actual</Heading>
      <p className="text-sm text-slate-500">
        Every pay period touching the range, whole, with the planner's numbers. Account and payee
        filters do not apply here.
      </p>
      {data.periods.length > 0 && (
        <div className="mt-4">
          <GroupedBars
            name="Planned and actual spending per pay period"
            rows={data.periods.map((p) => ({
              label: p.start.slice(5),
              planned: p.planned_expense_cents,
              actual: p.actual_expense_cents,
            }))}
            series={[
              { key: 'planned', name: 'Planned spending', slot: 0 },
              { key: 'actual', name: 'Actual spending', slot: 1 },
            ]}
          />
        </div>
      )}
      <ReportTable
        report="planned-vs-actual-periods"
        caption="Per pay period"
        range={range}
        rows={data.periods}
        rowKey={(row) => row.period_id}
        columns={[
          {
            header: 'Pay period',
            cell: (row) => `${row.start} – ${row.end}${row.is_transition ? ' (transition)' : ''}`,
            csv: (row) => `${row.start} – ${row.end}`,
          },
          {
            header: 'Planned spending',
            cell: (row) => money(row.planned_expense_cents),
            csv: (row) => centsCsv(row.planned_expense_cents),
            align: 'right',
          },
          {
            header: 'Actual spending',
            cell: (row) => money(row.actual_expense_cents),
            csv: (row) => centsCsv(row.actual_expense_cents),
            align: 'right',
          },
          {
            header: 'Variance',
            cell: (row) => money(row.planned_expense_cents - row.actual_expense_cents),
            csv: (row) => centsCsv(row.planned_expense_cents - row.actual_expense_cents),
            align: 'right',
          },
          {
            header: 'Income planned',
            cell: (row) => money(row.planned_income_cents),
            csv: (row) => centsCsv(row.planned_income_cents),
            align: 'right',
          },
          {
            header: 'Income received',
            cell: (row) => money(row.actual_income_cents),
            csv: (row) => centsCsv(row.actual_income_cents),
            align: 'right',
          },
        ]}
      />
      <h3 className="mt-6 text-sm font-semibold">By category, over these periods</h3>
      <ReportTable
        report="planned-vs-actual-categories"
        range={range}
        rows={data.categories}
        rowKey={(row) => row.category_id}
        columns={[
          { header: 'Category', cell: (row) => row.name, csv: (row) => row.name },
          { header: 'Group', cell: (row) => row.group_name, csv: (row) => row.group_name },
          { header: 'Kind', cell: (row) => row.kind, csv: (row) => row.kind },
          {
            header: 'Planned',
            cell: (row) => money(row.planned_cents),
            csv: (row) => centsCsv(row.planned_cents),
            align: 'right',
          },
          {
            header: 'Actual',
            cell: (row) => money(row.actual_cents),
            csv: (row) => centsCsv(row.actual_cents),
            align: 'right',
          },
          {
            header: 'Variance',
            cell: (row) => money(row.variance_cents),
            csv: (row) => centsCsv(row.variance_cents),
            align: 'right',
          },
        ]}
      />
    </section>
  )
}

// ------------------------------------------------------------------------- category trend

export function CategoryTrendReport({ query, qs }: ReportContext) {
  const picked = query.categoryIds.length > 0
  const report = useQuery({
    queryKey: queryKeys.report('category-trend', qs),
    queryFn: ({ signal }) => reportsApi.categoryTrend(qs, signal),
    enabled: picked,
  })
  if (!picked)
    return (
      <section>
        <Heading>Category trend</Heading>
        <p className="mt-2 text-sm text-slate-500">
          Pick one or more categories in the Categories filter above.
        </p>
      </section>
    )
  const data = report.data
  if (!data) return <Loading error={report.error} />
  // Colour follows the category's place in the filter, so it never changes with the data.
  const shown = data.series.slice(0, 8)
  const rows = data.months.map((month, index) => {
    const row: Record<string, string | number> = { label: month.start.slice(0, 7) }
    for (const item of shown) row[String(item.category_id)] = item.values[index]
    return row
  })
  return (
    <section>
      <Heading>Category trend</Heading>
      {data.series.length > 8 && (
        <p className="text-sm text-amber-700">
          The chart shows the first 8 categories; the table has them all.
        </p>
      )}
      <div className="mt-4">
        <Lines
          name="Monthly actuals"
          rows={rows}
          series={shown.map((item, index) => ({
            key: String(item.category_id),
            name: item.name,
            slot: index,
          }))}
        />
      </div>
      <ReportTable
        report="category-trend"
        range={{ start: data.start, end: data.end }}
        rows={data.series}
        rowKey={(row) => row.category_id}
        columns={[
          { header: 'Category', cell: (row) => row.name, csv: (row) => row.name },
          ...data.months.map((month, index) => ({
            header: month.start.slice(0, 7),
            cell: (row: (typeof data.series)[number]) => money(row.values[index]),
            csv: (row: (typeof data.series)[number]) => centsCsv(row.values[index]),
            align: 'right' as const,
          })),
        ]}
      />
    </section>
  )
}

// --------------------------------------------------------------------------- subscriptions

export function SubscriptionsReport() {
  const report = useQuery({
    queryKey: queryKeys.report('subscriptions', ''),
    queryFn: ({ signal }) => reportsApi.subscriptions(signal),
  })
  const data = report.data
  if (!data) return <Loading error={report.error} />
  const today = new Date().toISOString().slice(0, 10)
  return (
    <section>
      <Heading>Subscriptions</Heading>
      <p className="text-sm text-slate-500">Active subscriptions, whatever the date filter says.</p>
      <div className="mt-2 flex gap-6 text-sm">
        <span>
          Monthly <strong className="tabular-nums">{formatCents(data.monthly_cents)}</strong>
        </span>
        <span>
          Annual <strong className="tabular-nums">{formatCents(data.annual_cents)}</strong>
        </span>
      </div>
      {data.items.length > 0 && (
        <div className="mt-4">
          <HorizontalBars
            name="Annual cost by category"
            rows={data.items.map((row) => ({ label: row.name, value: row.annual_cents }))}
          />
        </div>
      )}
      <ReportTable
        report="subscriptions"
        range={{ start: today, end: today }}
        rows={data.items}
        rowKey={(row) => row.category_id ?? 'none'}
        columns={[
          { header: 'Category', cell: (row) => row.name, csv: (row) => row.name },
          {
            header: 'Subscriptions',
            cell: (row) => row.count,
            csv: (row) => row.count,
            align: 'right',
          },
          {
            header: 'Monthly',
            cell: (row) => money(row.monthly_cents),
            csv: (row) => centsCsv(row.monthly_cents),
            align: 'right',
          },
          {
            header: 'Annual',
            cell: (row) => money(row.annual_cents),
            csv: (row) => centsCsv(row.annual_cents),
            align: 'right',
          },
        ]}
        footer={
          <TotalRow
            label="Total"
            cells={['', formatCents(data.monthly_cents), formatCents(data.annual_cents)]}
          />
        }
      />
    </section>
  )
}

// ------------------------------------------------------------------------ transaction list

export function TransactionListReport({ qs, search, names }: ReportContext) {
  const extra = new URLSearchParams()
  if (search.get('on_budget') === '1') extra.set('on_budget', 'true')
  const flow = search.get('flow')
  if (flow === 'in' || flow === 'out') extra.set('flow', flow)
  const full = [qs, extra.toString()].filter(Boolean).join('&')
  const report = useQuery({
    queryKey: queryKeys.report('transactions', full),
    queryFn: ({ signal }) => reportsApi.transactions(full, signal),
  })
  const data = report.data
  if (!data) return <Loading error={report.error} />
  type Row = (typeof data.items)[number]
  const categoryOf = (row: Row) =>
    row.transaction.transfer_id !== null && row.transaction.splits.length === 0
      ? 'Transfer'
      : row.transaction.splits.length > 1
        ? 'Split'
        : names.category(row.transaction.splits[0]?.category_id ?? null)
  const payeeOf = (row: Row) =>
    row.transaction.transfer_account_id !== null
      ? `Transfer: ${names.account(row.transaction.transfer_account_id)}`
      : names.payee(row.transaction.payee_id)
  return (
    <section>
      <Heading>Transactions</Heading>
      {search.get('on_budget') === '1' && (
        <p className="text-sm text-slate-500">
          On-budget accounts{flow === 'out' ? ', money out only' : ''}. With a category filter each
          row counts only its matching splits.
        </p>
      )}
      {data.truncated && (
        <p className="mt-1 text-sm text-amber-700">
          Showing the first 10,000 transactions; narrow the filters to see the rest.
        </p>
      )}
      <ReportTable
        report="transactions"
        range={{ start: data.start, end: data.end }}
        rows={data.items}
        rowKey={(row) => row.transaction.id}
        columns={[
          {
            header: 'Date',
            cell: (row) => row.transaction.date,
            csv: (row) => row.transaction.date,
          },
          {
            header: 'Account',
            cell: (row) => names.account(row.transaction.account_id),
            csv: (row) => names.account(row.transaction.account_id),
          },
          { header: 'Payee', cell: payeeOf, csv: payeeOf },
          { header: 'Category', cell: categoryOf, csv: categoryOf },
          {
            header: 'Memo',
            cell: (row) => row.transaction.memo ?? '',
            csv: (row) => row.transaction.memo ?? '',
          },
          {
            header: 'Amount',
            cell: (row) => money(row.amount_cents),
            csv: (row) => centsCsv(row.amount_cents),
            align: 'right',
          },
          {
            header: 'Running total',
            cell: (row) => money(row.running_cents),
            csv: (row) => centsCsv(row.running_cents),
            align: 'right',
          },
        ]}
        footer={
          <TotalRow label="Total" cells={['', '', '', '', formatCents(data.total_cents), '']} />
        }
      />
    </section>
  )
}

const NET_WORTH_RANGES = [
  { key: '12', label: '12 months' },
  { key: '24', label: '24 months' },
  { key: 'all', label: 'Since the first account' },
]

/** Net worth (SPEC §14): assets − liabilities at each month-end, and by account type now. */
export function NetWorthReport({ search }: ReportContext) {
  const raw = search.get('months') ?? '24'
  const range = NET_WORTH_RANGES.some((item) => item.key === raw) ? raw : '24'
  const report = useQuery({
    queryKey: queryKeys.netWorth(range),
    queryFn: ({ signal }) => fetchNetWorth(range, signal),
  })
  const data = report.data
  if (!data) return <Loading error={report.error} />
  const history = data.history
  const span = { start: history[0]?.date ?? data.today.date, end: data.today.date }
  const owed = (cents: number) => formatCents(-cents)
  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <Heading>Net worth</Heading>
        <nav className="no-print flex gap-3 text-sm" aria-label="Net worth range">
          {NET_WORTH_RANGES.map((item) => {
            const next = new URLSearchParams(search)
            next.set('months', item.key)
            return item.key === range ? (
              <span key={item.key} className="font-medium">
                {item.label}
              </span>
            ) : (
              <Link key={item.key} className={LINK} to={`?${next.toString()}`} replace>
                {item.label}
              </Link>
            )
          })}
        </nav>
      </div>
      <div className="mt-2 flex flex-wrap gap-6 text-sm" data-testid="net-worth-summary">
        <span>
          Net worth <strong className="tabular-nums">{formatCents(data.today.net_cents)}</strong>
        </span>
        <span>
          Assets <strong className="tabular-nums">{formatCents(data.today.assets_cents)}</strong>
        </span>
        <span>
          Owed <strong className="tabular-nums">{owed(data.today.liabilities_cents)}</strong>
        </span>
      </div>
      <p className="text-xs text-slate-500">
        Every open account, on-budget and tracking. Each month-end counts the accounts open on that
        day, with typed balances for manually valued accounts.
      </p>
      {history.length > 1 && (
        <div className="mt-4">
          <Lines
            name="Net worth at each month-end"
            rows={history.map((point) => ({ label: point.date.slice(0, 7), net: point.net_cents }))}
            series={[{ key: 'net', name: 'Net worth', slot: 0 }]}
          />
        </div>
      )}
      <ReportTable
        report="net-worth"
        range={span}
        rows={[...history].reverse()}
        rowKey={(row) => row.date}
        columns={[
          { header: 'Date', cell: (row) => row.date, csv: (row) => row.date },
          {
            header: 'Assets',
            cell: (row) => money(row.assets_cents),
            csv: (row) => centsCsv(row.assets_cents),
            align: 'right',
          },
          {
            header: 'Owed',
            cell: (row) => owed(row.liabilities_cents),
            csv: (row) => centsCsv(-row.liabilities_cents),
            align: 'right',
          },
          {
            header: 'Net worth',
            cell: (row) => money(row.net_cents),
            csv: (row) => centsCsv(row.net_cents),
            align: 'right',
          },
        ]}
      />
      <h3 className="mt-6 text-sm font-semibold">By account type, today</h3>
      <ReportTable
        report="net-worth-by-type"
        range={{ start: data.today.date, end: data.today.date }}
        rows={data.breakdown.flatMap((group) => [
          {
            key: `t-${group.type}`,
            label: group.label,
            detail: '',
            group,
            cents: group.balance_cents,
            heading: true,
          },
          ...group.accounts.map((a) => ({
            key: `a-${a.account_id}`,
            label: '',
            detail: a.name,
            group,
            cents: a.balance_cents,
            heading: false,
          })),
        ])}
        rowKey={(row) => row.key}
        columns={[
          {
            header: 'Type',
            cell: (row) => (row.heading ? <strong>{row.label}</strong> : ''),
            csv: (row) => row.group.label,
          },
          { header: 'Account', cell: (row) => row.detail, csv: (row) => row.detail || 'All' },
          {
            header: 'Balance',
            cell: (row) => (row.group.is_liability ? `${owed(row.cents)} owed` : money(row.cents)),
            csv: (row) => centsCsv(row.cents),
            align: 'right',
          },
        ]}
      />
    </section>
  )
}
