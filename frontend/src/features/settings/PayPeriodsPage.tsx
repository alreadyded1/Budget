import { useQuery } from '@tanstack/react-query'

import { queryKeys } from '../../api/keys'
import { fetchCurrentPeriod, fetchPeriods } from '../../api/paySchedule'
import { ApiRequestError } from '../../api/client'
import { formatRange } from '../../lib/periods'

export function PayPeriodsPage() {
  const periods = useQuery({
    queryKey: queryKeys.payPeriods,
    queryFn: ({ signal }) => fetchPeriods({}, signal),
  })
  const current = useQuery({
    queryKey: queryKeys.currentPeriod,
    queryFn: ({ signal }) => fetchCurrentPeriod(signal),
    retry: false,
  })

  if (periods.isPending) return <p className="text-sm text-slate-500">Loading…</p>

  if (periods.error instanceof ApiRequestError) {
    return <p className="text-sm text-slate-500">{periods.error.detail}</p>
  }

  const items = periods.data?.items ?? []
  if (items.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No pay periods yet. Set up the pay schedule and they appear here.
      </p>
    )
  }

  return (
    <div>
      <p className="text-sm text-slate-500">
        {items.length} periods, from {items[0].start_date} to {items[items.length - 1].end_date}.
        Every calendar date belongs to exactly one of them.
      </p>
      <ul className="mt-4 divide-y divide-slate-100 text-sm dark:divide-slate-800">
        {items.map((period) => {
          const isCurrent = current.data?.id === period.id
          return (
            <li
              key={period.id}
              className={[
                'flex items-center justify-between gap-3 py-2',
                isCurrent ? 'font-medium' : '',
              ].join(' ')}
            >
              <span>{formatRange(period.start_date, period.end_date)}</span>
              <span className="flex shrink-0 items-center gap-2 text-xs">
                {period.is_transition ? (
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                    transition
                  </span>
                ) : null}
                {isCurrent ? (
                  <span className="rounded bg-sky-100 px-2 py-0.5 text-sky-900 dark:bg-sky-950 dark:text-sky-100">
                    current
                  </span>
                ) : null}
                <span className="text-slate-500">{period.days} days</span>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
