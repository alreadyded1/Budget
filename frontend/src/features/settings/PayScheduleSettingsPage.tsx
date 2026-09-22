import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { ApiRequestError } from '../../api/client'
import { queryKeys } from '../../api/keys'
import { commitSchedule, fetchSchedule, previewSchedule } from '../../api/paySchedule'
import type { Frequency, ScheduleInput, WeekendRule } from '../../api/paySchedule'
import { useToast } from '../../components/toastContext'
import { describeSchedule, formatDate, formatRange, weekendRuleApplies } from '../../lib/periods'

const inputClass =
  'mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:bg-slate-950'

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every two weeks' },
  { value: 'semimonthly', label: 'Twice a month' },
  { value: 'monthly', label: 'Monthly' },
]

const WEEKEND_RULES: { value: WeekendRule; label: string }[] = [
  { value: 'none', label: 'Leave it on the weekend' },
  { value: 'previous_business_day', label: 'Pay on the previous business day' },
  { value: 'next_business_day', label: 'Pay on the next business day' },
]

function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`
}

export function PayScheduleSettingsPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const { data, isPending } = useQuery({
    queryKey: queryKeys.paySchedule,
    queryFn: ({ signal }) => fetchSchedule(signal),
  })

  const [draft, setDraft] = useState<ScheduleInput>({
    frequency: 'biweekly',
    effective_from: today(),
    anchor_date: today(),
    day_of_month_1: 15,
    day_of_month_2: 31,
    weekend_rule: 'none',
  })

  // The preview endpoint writes nothing, so it is safe to call on every edit.
  const preview = useQuery({
    queryKey: [...queryKeys.paySchedulePreview, draft],
    queryFn: () => previewSchedule(draft),
    retry: false,
  })

  const commit = useMutation({
    mutationFn: commitSchedule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.paySchedule })
      queryClient.invalidateQueries({ queryKey: queryKeys.payPeriods })
      toast('Pay schedule saved.', 'success')
    },
    onError: (error) =>
      toast(error instanceof ApiRequestError ? error.detail : 'Could not save the schedule.'),
  })

  if (isPending) return <p className="text-sm text-slate-500">Loading…</p>

  const usesAnchor = draft.frequency === 'weekly' || draft.frequency === 'biweekly'
  const previewError = preview.error instanceof ApiRequestError ? preview.error.detail : null

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    commit.mutate(draft)
  }

  return (
    <div>
      {data?.current ? (
        <div className="mb-6 rounded border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="font-medium">{describeSchedule(data.current)}</div>
          <div className="mt-1 text-xs text-slate-500">
            In effect since {formatDate(data.current.effective_from)}
          </div>
        </div>
      ) : (
        <p className="mb-6 text-sm text-slate-500">
          No pay schedule yet. Set one up and the budget's periods follow from it.
        </p>
      )}

      <form onSubmit={handleSubmit}>
        <h2 className="text-sm font-semibold">
          {data?.current ? 'Change the schedule' : 'Set up the schedule'}
        </h2>

        <label htmlFor="frequency" className="mt-4 block text-sm font-medium">
          How often are you paid?
        </label>
        <select
          id="frequency"
          value={draft.frequency}
          onChange={(event) => setDraft({ ...draft, frequency: event.target.value as Frequency })}
          className={inputClass}
        >
          {FREQUENCIES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {usesAnchor ? (
          <>
            <label htmlFor="anchor_date" className="mt-4 block text-sm font-medium">
              A pay date to count from
            </label>
            <input
              id="anchor_date"
              type="date"
              value={draft.anchor_date ?? ''}
              onChange={(event) => setDraft({ ...draft, anchor_date: event.target.value })}
              className={inputClass}
            />
          </>
        ) : (
          <>
            <label htmlFor="day_of_month_1" className="mt-4 block text-sm font-medium">
              {draft.frequency === 'monthly' ? 'Day of the month' : 'First day of the month'}
            </label>
            <input
              id="day_of_month_1"
              type="number"
              min={1}
              max={31}
              value={draft.day_of_month_1 ?? 1}
              onChange={(event) =>
                setDraft({ ...draft, day_of_month_1: Number(event.target.value) })
              }
              className={`${inputClass} w-28`}
            />
            {draft.frequency === 'semimonthly' ? (
              <>
                <label htmlFor="day_of_month_2" className="mt-4 block text-sm font-medium">
                  Second day of the month
                </label>
                <input
                  id="day_of_month_2"
                  type="number"
                  min={1}
                  max={31}
                  value={draft.day_of_month_2 ?? 15}
                  onChange={(event) =>
                    setDraft({ ...draft, day_of_month_2: Number(event.target.value) })
                  }
                  className={`${inputClass} w-28`}
                />
              </>
            ) : null}
            <p className="mt-1 text-xs text-slate-500">
              Day 31 becomes the last day of a shorter month, and the month after goes back to the
              31st.
            </p>
          </>
        )}

        {weekendRuleApplies(draft.frequency) ? (
          <>
            <label htmlFor="weekend_rule" className="mt-4 block text-sm font-medium">
              When a pay date lands on a weekend
            </label>
            <select
              id="weekend_rule"
              value={draft.weekend_rule}
              onChange={(event) =>
                setDraft({ ...draft, weekend_rule: event.target.value as WeekendRule })
              }
              className={inputClass}
            >
              {WEEKEND_RULES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </>
        ) : null}

        <label htmlFor="effective_from" className="mt-4 block text-sm font-medium">
          Starting from
        </label>
        <input
          id="effective_from"
          type="date"
          value={draft.effective_from}
          onChange={(event) => setDraft({ ...draft, effective_from: event.target.value })}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-slate-500">
          Past pay periods never change. The period you are in now ends the day before this date.
        </p>

        <section className="mt-6 rounded border border-slate-200 p-3 dark:border-slate-800">
          <h3 className="text-sm font-semibold">Next six periods</h3>
          {previewError ? (
            <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{previewError}</p>
          ) : preview.data ? (
            <>
              {preview.data.transition ? (
                <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                  The period in progress becomes a transition period:{' '}
                  {formatRange(
                    preview.data.transition.start_date,
                    preview.data.transition.end_date,
                  )}{' '}
                  ({preview.data.transition.days} days).
                </p>
              ) : null}
              <ol className="mt-2 divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {preview.data.periods.map((period) => (
                  <li key={period.start_date} className="flex justify-between gap-3 py-1.5">
                    <span>{formatRange(period.start_date, period.end_date)}</span>
                    <span className="shrink-0 text-xs text-slate-500">{period.days} days</span>
                  </li>
                ))}
              </ol>
              {preview.data.unshifted_dates.length > 0 ? (
                <p className="mt-2 text-xs text-slate-500">
                  {preview.data.unshifted_dates.length} pay date
                  {preview.data.unshifted_dates.length === 1 ? ' was' : 's were'} left on the
                  weekend, because moving them would have put two pay dates out of order.
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-500">Working it out…</p>
          )}
        </section>

        <button
          type="submit"
          disabled={commit.isPending || !!previewError}
          className="mt-6 rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {data?.current ? 'Save this change' : 'Save schedule'}
        </button>
      </form>

      {data && data.history.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-sm font-semibold">Schedule history</h2>
          <ul className="mt-2 divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {data.history.map((schedule) => (
              <li key={schedule.id} className="py-2">
                <div>{describeSchedule(schedule)}</div>
                <div className="text-xs text-slate-500">
                  From {formatDate(schedule.effective_from)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
