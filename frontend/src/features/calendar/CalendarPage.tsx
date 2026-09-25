import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { queryKeys } from '../../api/keys'
import { fetchPeriods } from '../../api/paySchedule'
import { fetchSettings } from '../../api/settings'
import { fetchBills } from '../../api/subscriptions'
import type { Bill } from '../../api/subscriptions'
import { isTypingTarget } from '../../components/useRowNavigation'
import { addMonths, monthGrid, monthStart, monthTitle, weekdayLabels } from '../../lib/calendar'
import { todayIso } from '../../lib/dates'
import { formatCents } from '../../lib/money'
import { useReferenceData } from '../ledger/useLedgerData'
import { useBillActions } from './useBillActions'

type Tone = 'paid' | 'skipped' | 'overdue' | 'upcoming'

function toneOf(bill: Bill): Tone {
  if (bill.status === 'paid') return 'paid'
  if (bill.status === 'skipped') return 'skipped'
  return bill.overdue ? 'overdue' : 'upcoming'
}

const CHIP: Record<Tone, string> = {
  paid: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  skipped: 'bg-slate-100 text-slate-500 line-through dark:bg-slate-800',
  overdue: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
  upcoming: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
}

const TONE_LABEL: Record<Tone, string> = {
  paid: 'paid',
  skipped: 'skipped',
  overdue: 'overdue',
  upcoming: 'upcoming',
}

/** The bill calendar (SPEC §9): a month grid with pay dates marked, a list on phones. */
export function CalendarPage() {
  const [params, setParams] = useSearchParams()
  const today = todayIso()
  const month = monthStart(params.get('month') ? `${params.get('month')}-01` : today)
  const settings = useQuery({
    queryKey: queryKeys.settings,
    queryFn: ({ signal }) => fetchSettings(signal),
  })
  const weekStart = settings.data?.week_start ?? 0
  const weeks = useMemo(() => monthGrid(month, weekStart), [month, weekStart])
  const from = weeks[0][0]
  const to = weeks[weeks.length - 1][6]
  const reference = useReferenceData()
  const actions = useBillActions()
  // A notification's link opens its bill: /calendar?month=2026-10&bill=123
  const [selectedId, setSelectedId] = useState<number | null>(
    () => Number(params.get('bill')) || null,
  )

  const bills = useQuery({
    queryKey: queryKeys.billRange(from, to),
    queryFn: ({ signal }) => fetchBills(from, to, signal),
  })
  const periods = useQuery({
    queryKey: [...queryKeys.payPeriods, from, to],
    queryFn: ({ signal }) => fetchPeriods({ from, to }, signal),
  })

  const go = (target: string) => setParams({ month: target.slice(0, 7) })

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      if (event.key === '[') go(addMonths(month, -1))
      else if (event.key === ']') go(addMonths(month, 1))
      else if (event.key === 't') go(today)
      else if (event.key === 'Escape') setSelectedId(null)
      else return
      event.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const byDate = useMemo(() => {
    const map = new Map<string, Bill[]>()
    for (const bill of bills.data?.items ?? []) {
      const list = map.get(bill.due_date) ?? []
      list.push(bill)
      map.set(bill.due_date, list)
    }
    return map
  }, [bills.data])
  const payDates = useMemo(
    () => new Set((periods.data?.items ?? []).map((period) => period.start_date)),
    [periods.data],
  )
  const inMonth = (iso: string) => iso.slice(0, 7) === month.slice(0, 7)
  const monthBills = (bills.data?.items ?? []).filter((bill) => inMonth(bill.due_date))
  const selected =
    (bills.data?.items ?? []).find((bill) => bill.occurrence_id === selectedId) ?? null
  const accountName = (id: number | null) =>
    reference.accounts.find((account) => account.id === id)?.name ?? '—'
  const categoryName = (id: number | null) =>
    id === null ? '—' : (reference.categoryNames.get(id) ?? '—')

  const navButton =
    'rounded border border-slate-300 px-2 py-1 text-sm outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:hover:bg-slate-800'

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Bill calendar</h1>
          <p className="text-sm text-slate-600 dark:text-slate-300" data-testid="calendar-month">
            {monthTitle(month)}
          </p>
        </div>
        <nav className="flex gap-1" aria-label="Months">
          <button
            type="button"
            className={navButton}
            onClick={() => go(addMonths(month, -1))}
            title="Previous month ( [ )"
          >
            ← Previous
          </button>
          <button
            type="button"
            className={navButton}
            onClick={() => go(today)}
            title="This month ( t )"
          >
            Today
          </button>
          <button
            type="button"
            className={navButton}
            onClick={() => go(addMonths(month, 1))}
            title="Next month ( ] )"
          >
            Next →
          </button>
        </nav>
      </div>

      <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
        {(['upcoming', 'overdue', 'paid', 'skipped'] as Tone[]).map((tone) => (
          <span key={tone} className={`rounded px-1.5 ${CHIP[tone]}`}>
            {TONE_LABEL[tone]}
          </span>
        ))}
        <span className="rounded border border-emerald-500 px-1.5 text-emerald-700 dark:text-emerald-300">
          payday
        </span>
      </div>

      {/* Month grid: tablets and up. */}
      <div
        className="mt-3 hidden overflow-hidden rounded border border-slate-200 sm:block dark:border-slate-800"
        role="grid"
        aria-label={monthTitle(month)}
      >
        <div
          className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900"
          role="row"
        >
          {weekdayLabels(weekStart).map((label) => (
            <div key={label} className="px-2 py-1" role="columnheader">
              {label}
            </div>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0]} className="grid grid-cols-7" role="row">
            {week.map((iso) => {
              const dayBills = byDate.get(iso) ?? []
              const payday = payDates.has(iso)
              return (
                <div
                  key={iso}
                  role="gridcell"
                  data-date={iso}
                  className={[
                    'min-h-24 border-r border-b border-slate-100 p-1 text-xs dark:border-slate-800',
                    inMonth(iso)
                      ? 'bg-white dark:bg-slate-950'
                      : 'bg-slate-50 text-slate-400 dark:bg-slate-900/50',
                    iso === today ? 'ring-2 ring-sky-400 ring-inset' : '',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={
                        iso === today ? 'font-semibold text-sky-700 dark:text-sky-300' : ''
                      }
                    >
                      {Number(iso.slice(8))}
                    </span>
                    {payday && (
                      <span
                        className="rounded border border-emerald-500 px-1 text-[10px] text-emerald-700 dark:text-emerald-300"
                        data-testid={`payday-${iso}`}
                      >
                        payday
                      </span>
                    )}
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {dayBills.map((bill) => (
                      <BillChip
                        key={bill.occurrence_id}
                        bill={bill}
                        onOpen={() => setSelectedId(bill.occurrence_id)}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* List: phones. */}
      <ul className="mt-3 space-y-1 sm:hidden" aria-label="Bills this month">
        {monthBills.length === 0 && (
          <li className="text-sm text-slate-500">No bills this month.</li>
        )}
        {monthBills.map((bill) => (
          <li key={bill.occurrence_id}>
            <button
              type="button"
              onClick={() => setSelectedId(bill.occurrence_id)}
              className={`flex w-full justify-between rounded px-2 py-1.5 text-left text-sm ${CHIP[toneOf(bill)]}`}
            >
              <span>
                {bill.due_date.slice(5)} · {bill.name}
              </span>
              <span className="tabular-nums">{formatCents(bill.amount_cents)}</span>
            </button>
          </li>
        ))}
      </ul>

      {selected && (
        <div
          className="mt-4 max-w-md rounded border border-slate-200 bg-white p-4 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-900"
          role="dialog"
          aria-label={`${selected.name} due ${selected.due_date}`}
          data-testid="bill-detail"
        >
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">{selected.name}</h2>
            <span className={`rounded px-1.5 text-xs ${CHIP[toneOf(selected)]}`}>
              {TONE_LABEL[toneOf(selected)]}
            </span>
          </div>
          <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-y-0.5">
            <dt className="text-slate-500">Due</dt>
            <dd>{selected.due_date}</dd>
            <dt className="text-slate-500">Amount</dt>
            <dd className="tabular-nums">{formatCents(selected.amount_cents)}</dd>
            <dt className="text-slate-500">Paid from</dt>
            <dd>{accountName(selected.account_id)}</dd>
            <dt className="text-slate-500">Category</dt>
            <dd>{categoryName(selected.category_id)}</dd>
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            {selected.status === 'upcoming' && (
              <>
                <button
                  type="button"
                  autoFocus
                  onClick={() => actions.markPaid(selected)}
                  className="rounded bg-sky-700 px-3 py-1 text-sm font-medium text-white hover:bg-sky-800"
                >
                  Mark paid
                </button>
                <button type="button" onClick={() => actions.skip(selected)} className={navButton}>
                  Skip
                </button>
              </>
            )}
            {selected.status !== 'upcoming' && (
              <button
                type="button"
                autoFocus
                onClick={() => actions.reopen(selected)}
                className={navButton}
              >
                {selected.status === 'paid' ? 'Mark unpaid' : 'Unskip'}
              </button>
            )}
            {selected.url && (
              <a href={selected.url} target="_blank" rel="noreferrer" className={navButton}>
                Manage
              </a>
            )}
            <button type="button" onClick={() => setSelectedId(null)} className={navButton}>
              Close
            </button>
          </div>
        </div>
      )}

      <p className="mt-4 text-xs text-slate-400">
        [ and ] change month, t returns to today, Esc closes a bill.{' '}
        <Link to="/subscriptions" className="underline">
          Manage subscriptions
        </Link>
      </p>
    </div>
  )
}

function BillChip({ bill, onOpen }: { bill: Bill; onOpen: () => void }) {
  const tone = toneOf(bill)
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`bill-${bill.name}-${bill.due_date}`}
      data-status={tone}
      title={`${bill.name} · ${formatCents(bill.amount_cents)} · ${TONE_LABEL[tone]}`}
      className={`flex w-full justify-between gap-1 truncate rounded px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${CHIP[tone]}`}
    >
      <span className="truncate">{bill.name}</span>
      <span className="tabular-nums">{formatCents(bill.amount_cents)}</span>
    </button>
  )
}
