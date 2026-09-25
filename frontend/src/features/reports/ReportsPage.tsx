import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { NavLink, useParams, useSearchParams } from 'react-router-dom'

import { ApiRequestError } from '../../api/client'
import { queryKeys } from '../../api/keys'
import { reportParams, reportsApi } from '../../api/reports'
import type { ReportQuery } from '../../api/reports'
import { useReferenceData } from '../ledger/useLedgerData'
import { queryFromSearch, searchFromQuery } from './query'
import { ReportFilters } from './ReportFilters'
import type { Choice } from './ReportFilters'
import {
  CategoryTrendReport,
  IncomeVsExpenseReport,
  NetWorthReport,
  PlannedVsActualReport,
  SpendingByCategoryReport,
  SpendingByPayeeReport,
  SubscriptionsReport,
  TransactionListReport,
} from './views'
import type { ReportContext } from './views'

const REPORTS = [
  { key: 'spending', label: 'Spending', view: SpendingByCategoryReport },
  { key: 'planned', label: 'Planned vs. actual', view: PlannedVsActualReport },
  { key: 'income', label: 'Income vs. expense', view: IncomeVsExpenseReport },
  { key: 'payees', label: 'Payees', view: SpendingByPayeeReport },
  { key: 'trend', label: 'Category trend', view: CategoryTrendReport },
  { key: 'net-worth', label: 'Net worth', view: NetWorthReport },
  { key: 'subscriptions', label: 'Bills & Recurring', view: SubscriptionsReport },
  { key: 'transactions', label: 'Transactions', view: TransactionListReport },
] as const

/** Filters that belong to one report and do not follow you to the next tab. */
const LOCAL_PARAMS = ['on_budget', 'flow', 'by', 'months']

/** Reports (SPEC §16): one filter row, a tab per report, tables that export to CSV. */
export default function ReportsPage() {
  const params = useParams()
  const [search, setSearch] = useSearchParams()
  const reference = useReferenceData()
  const active = REPORTS.find((report) => report.key === params.report) ?? REPORTS[0]
  const query = useMemo(() => queryFromSearch(search), [search])
  const qs = reportParams(query)

  const range = useQuery({
    queryKey: queryKeys.report('range', qs),
    queryFn: ({ signal }) => reportsApi.range(qs, signal),
    retry: false,
  })

  function change(next: ReportQuery) {
    setSearch(searchFromQuery(next))
  }

  const accounts = useMemo<Choice[]>(
    () => reference.accounts.map((account) => ({ id: account.id, label: account.name })),
    [reference.accounts],
  )
  const categories = useMemo<Choice[]>(
    () =>
      reference.categories.map((category) => ({
        id: category.id,
        label: category.name,
        group: category.groupName,
      })),
    [reference.categories],
  )
  const payees = useMemo<Choice[]>(
    () =>
      reference.payees
        .filter((payee) => !payee.is_hidden)
        .map((payee) => ({ id: payee.id, label: payee.name })),
    [reference.payees],
  )

  const context: ReportContext = {
    query,
    qs,
    search,
    names: {
      account: (id) => reference.accounts.find((account) => account.id === id)?.name ?? '?',
      payee: (id) =>
        id === null ? '' : (reference.payees.find((payee) => payee.id === id)?.name ?? '?'),
      category: (id) => (id === null ? 'Uncategorized' : (reference.categoryNames.get(id) ?? '?')),
    },
  }
  const shared = searchFromQuery(query)
  for (const key of LOCAL_PARAMS) shared.delete(key)
  const View = active.view

  return (
    <section>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Reports</h1>
        <button
          type="button"
          onClick={() => window.print()}
          className="no-print rounded px-2 text-xs text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
        >
          Print
        </button>
      </div>
      <nav
        className="no-print mt-4 flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800"
        aria-label="Reports"
      >
        {REPORTS.map((report) => (
          <NavLink
            key={report.key}
            to={`/reports/${report.key}?${shared.toString()}`}
            className={() =>
              [
                '-mb-px border-b-2 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500',
                report.key === active.key
                  ? 'border-slate-900 font-medium text-slate-900 dark:border-slate-100 dark:text-slate-100'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200',
              ].join(' ')
            }
          >
            {report.label}
          </NavLink>
        ))}
      </nav>
      {active.key !== 'subscriptions' && active.key !== 'net-worth' && (
        <ReportFilters
          // Remount when the dates change elsewhere (a drill-down), so the fields follow.
          key={`${query.preset}-${query.from}-${query.to}`}
          query={query}
          range={range.data}
          rangeError={
            range.error instanceof ApiRequestError
              ? range.error.detail
              : range.error
                ? 'That range did not work.'
                : null
          }
          accounts={accounts}
          categories={categories}
          payees={payees}
          onChange={change}
        />
      )}
      <p className="hidden text-sm print:block">
        {active.label}
        {range.data ? `: ${range.data.start} to ${range.data.end}` : ''}
      </p>
      {range.error && active.key !== 'subscriptions' && active.key !== 'net-worth' ? null : (
        <View {...context} />
      )}
    </section>
  )
}
