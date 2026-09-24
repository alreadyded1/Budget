import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type { FocusEvent, KeyboardEvent } from 'react'
import { flushSync } from 'react-dom'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { fetchBudget, runBudgetAction, setPlan, setPlanned } from '../../api/budget'
import type { BudgetAction, BudgetView, PlanGroup, PlanLine } from '../../api/budget'
import { ApiRequestError } from '../../api/client'
import { queryKeys } from '../../api/keys'
import { AmountInput } from '../../components/AmountInput'
import { useToast } from '../../components/toastContext'
import { isTypingTarget } from '../../components/useRowNavigation'
import { evaluateAmount } from '../../lib/amountExpr'
import { formatCents } from '../../lib/money'
import { centsToInput } from '../ledger/draft'
import { plannedAmounts, progress, withPlanned } from './budgetMath'

const PLAN_MUTATION = ['budget-plan'] as const

function errorText(error: unknown): string {
  return error instanceof ApiRequestError ? error.detail : 'That did not save. Nothing was changed.'
}

function formatPeriod(view: BudgetView): string {
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone: 'UTC' }
  const start = new Date(`${view.period.start_date}T00:00:00Z`)
  const end = new Date(`${view.period.end_date}T00:00:00Z`)
  const year = end.getUTCFullYear()
  return `${start.toLocaleDateString(undefined, options)} – ${end.toLocaleDateString(undefined, options)}, ${year}`
}

/** The budget planner (SPEC §8): /budget for the current period, /budget/:periodId for any. */
export function BudgetPage() {
  const { periodId: param } = useParams()
  const periodKey: number | 'current' = param === undefined ? 'current' : Number(param)
  const key = queryKeys.budget(periodKey)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()

  const budget = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchBudget(periodKey, signal),
  })
  const view = budget.data

  // Period navigation from the keyboard: [ previous, ] next, t today.
  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
      if (isTypingTarget(event.target) || !view) return
      if (event.key === '[' && view.previous_id !== null) navigate(`/budget/${view.previous_id}`)
      else if (event.key === ']' && view.next_id !== null) navigate(`/budget/${view.next_id}`)
      else if (event.key === 't') navigate('/budget')
      else return
      event.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [view, navigate])

  const markStale = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    // The same period may be cached under its id and under "current".
    void queryClient.invalidateQueries({
      queryKey: queryKeys.budgets,
      predicate: (query) => JSON.stringify(query.queryKey) !== JSON.stringify(key),
    })
  }

  const plan = useMutation({
    mutationKey: PLAN_MUTATION,
    mutationFn: ({
      periodId,
      categoryId,
      cents,
    }: {
      periodId: number
      categoryId: number
      cents: number
    }) => setPlanned(periodId, categoryId, cents),
    onMutate: async ({ categoryId, cents }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const before = queryClient.getQueryData<BudgetView>(key)
      if (before) queryClient.setQueryData(key, withPlanned(before, new Map([[categoryId, cents]])))
      return { before }
    },
    onError: (error, _vars, context) => {
      if (context?.before) queryClient.setQueryData(key, context.before)
      toast(errorText(error))
    },
    onSuccess: (server) => {
      // With several edits in flight, the last answer carries them all; an earlier one
      // would briefly undo the later optimistic edits.
      if (queryClient.isMutating({ mutationKey: PLAN_MUTATION }) <= 1) {
        queryClient.setQueryData(key, server)
      }
      markStale()
    },
  })

  const action = useMutation({
    mutationFn: ({ periodId, name }: { periodId: number; name: BudgetAction }) =>
      runBudgetAction(periodId, name),
    onSuccess: (server, { periodId, name }) => {
      const before = view ? plannedAmounts(view) : []
      queryClient.setQueryData(key, server)
      markStale()
      const label: Record<BudgetAction, string> = {
        'copy-previous': 'Copied the last period’s plan.',
        'apply-template': 'Applied the template.',
        clear: 'Cleared the plan.',
        prorate: 'Prorated the plan for this transition period.',
      }
      toast(label[name], 'success', {
        action: {
          label: 'Undo',
          onClick: () =>
            void setPlan(periodId, before)
              .then((restored) => {
                queryClient.setQueryData(key, restored)
                markStale()
              })
              .catch((error: unknown) => toast(errorText(error))),
        },
      })
    },
    onError: (error) => toast(errorText(error)),
  })

  if (budget.isPending) return <p className="text-sm text-slate-500">Loading…</p>
  if (budget.isError) {
    const noSchedule =
      budget.error instanceof ApiRequestError &&
      ['no_pay_schedule', 'no_current_period'].includes(budget.error.code)
    return (
      <div className="max-w-xl">
        <h1 className="text-xl font-semibold">Budget</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {noSchedule ? (
            <>
              The budget is planned per pay period. Set up your{' '}
              <Link to="/settings/pay-schedule" className="text-sky-600 underline">
                pay schedule
              </Link>{' '}
              first.
            </>
          ) : (
            errorText(budget.error)
          )}
        </p>
      </div>
    )
  }

  const periodId = view!.period.id
  const commit = (line: PlanLine, cents: number) =>
    plan.mutate({ periodId, categoryId: line.category_id, cents })
  const run = (name: BudgetAction) => action.mutate({ periodId, name })

  return <Planner view={view!} onCommit={commit} onAction={run} busy={action.isPending} />
}

type PlannerProps = {
  view: BudgetView
  onCommit: (line: PlanLine, cents: number) => void
  onAction: (name: BudgetAction) => void
  busy: boolean
}

function Planner({ view, onCommit, onAction, busy }: PlannerProps) {
  const { summary, period } = view
  const uncategorizedLink = `/transactions?from=${period.start_date}&to=${period.end_date}&uncategorized=1&on_budget=1`
  let index = 0
  const nextIndex = () => index++

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Budget</h1>
          <p className="text-sm text-slate-600 dark:text-slate-300" data-testid="period-label">
            {formatPeriod(view)} · {period.days} days
            {period.is_transition && (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                transition period
              </span>
            )}
          </p>
        </div>
        <nav className="flex gap-1 text-sm" aria-label="Pay periods">
          <PeriodLink to={view.previous_id} label="← Previous" title="Previous period ( [ )" />
          <Link to="/budget" className={NAV_BUTTON} title="Current period ( t )">
            Today
          </Link>
          <PeriodLink to={view.next_id} label="Next →" title="Next period ( ] )" />
        </nav>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="budget-summary">
        <Tile
          label="Expected income"
          cents={summary.expected_income_cents}
          testId="expected-income"
        />
        <Tile label="Planned" cents={summary.planned_expense_cents} testId="planned-total" />
        <Tile
          label="Left to plan"
          cents={summary.left_to_plan_cents}
          tone={
            summary.left_to_plan_cents < 0
              ? 'bad'
              : summary.left_to_plan_cents === 0
                ? 'good'
                : undefined
          }
          testId="left-to-plan"
        />
        <Tile label="Spent" cents={summary.spent_cents} testId="spent-total" />
        <Tile
          label="Remaining"
          cents={summary.remaining_cents}
          tone={summary.remaining_cents < 0 ? 'bad' : undefined}
          testId="remaining-total"
        />
      </dl>

      <div className="mt-3 flex flex-wrap gap-2">
        <ActionButton
          disabled={busy || view.previous_id === null}
          onClick={() => onAction('copy-previous')}
          label="Copy last period"
        />
        <ActionButton
          disabled={busy}
          onClick={() => onAction('apply-template')}
          label="Apply template"
        />
        <ActionButton disabled={busy} onClick={() => onAction('clear')} label="Clear plan" />
        {period.is_transition && (
          <ActionButton
            disabled={busy}
            onClick={() => onAction('prorate')}
            label={`Prorate (${period.days} days)`}
          />
        )}
      </div>

      {view.uncategorized_count > 0 && (
        <div
          className="mt-3 flex items-center justify-between rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100"
          role="alert"
        >
          <span>
            {view.uncategorized_count} uncategorized{' '}
            {view.uncategorized_count === 1 ? 'transaction' : 'transactions'} in this period.
          </span>
          <Link to={uncategorizedLink} className="font-medium underline">
            Review
          </Link>
        </div>
      )}

      <Section
        title="Income"
        actualLabel="Received"
        groups={view.income}
        onCommit={onCommit}
        nextIndex={nextIndex}
      />
      <Section
        title="Expenses"
        actualLabel="Actual"
        groups={view.expense}
        onCommit={onCommit}
        nextIndex={nextIndex}
      />

      {view.income.length + view.expense.length === 0 && (
        <p className="mt-6 text-sm text-slate-500">
          No categories yet. Add them under{' '}
          <Link to="/settings/categories" className="text-sky-600 underline">
            Settings → Categories
          </Link>
          .
        </p>
      )}
      <p className="mt-6 text-xs text-slate-400">
        Tab or Enter moves down the planned column; Esc undoes the field. [ and ] change period, t
        returns to today.
      </p>
    </div>
  )
}

const NAV_BUTTON =
  'rounded border border-slate-300 px-2 py-1 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:hover:bg-slate-800'

function PeriodLink({ to, label, title }: { to: number | null; label: string; title: string }) {
  if (to === null) {
    return <span className={`${NAV_BUTTON} cursor-not-allowed opacity-40`}>{label}</span>
  }
  return (
    <Link to={`/budget/${to}`} className={NAV_BUTTON} title={title}>
      {label}
    </Link>
  )
}

function ActionButton({
  label,
  onClick,
  disabled,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${NAV_BUTTON} text-sm disabled:opacity-40`}
    >
      {label}
    </button>
  )
}

function Tile({
  label,
  cents,
  tone,
  testId,
}: {
  label: string
  cents: number
  tone?: 'good' | 'bad'
  testId: string
}) {
  const color = tone === 'bad' ? 'text-rose-600' : tone === 'good' ? 'text-emerald-600' : ''
  return (
    <div className="rounded border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`text-lg font-semibold tabular-nums ${color}`} data-testid={testId}>
        {formatCents(cents)}
      </dd>
    </div>
  )
}

const GRID =
  'grid grid-cols-[minmax(10rem,1fr)_8rem_7rem_7rem_minmax(6rem,10rem)] items-center gap-3'

function Section({
  title,
  actualLabel,
  groups,
  onCommit,
  nextIndex,
}: {
  title: string
  actualLabel: string
  groups: PlanGroup[]
  onCommit: (line: PlanLine, cents: number) => void
  nextIndex: () => number
}) {
  if (groups.length === 0) return null
  return (
    <section className="mt-6" aria-label={title}>
      <div
        className={`${GRID} border-b border-slate-200 px-2 pb-1 text-xs font-medium tracking-wide text-slate-500 uppercase dark:border-slate-800`}
      >
        <div>{title}</div>
        <div className="pr-1.5 text-right">Planned</div>
        <div className="text-right">{actualLabel}</div>
        <div className="text-right">Remaining</div>
        <div />
      </div>
      {groups.map((group) => (
        <div key={group.id} className="border-b border-slate-100 dark:border-slate-800/70">
          <div
            className={`${GRID} bg-slate-100/70 px-2 py-1 text-sm font-medium dark:bg-slate-800/40`}
            data-testid={`group-${group.name}`}
          >
            <div>{group.name}</div>
            <div className="pr-1.5 text-right tabular-nums">{formatCents(group.planned_cents)}</div>
            <div className="text-right tabular-nums">{formatCents(group.actual_cents)}</div>
            <div
              className={`text-right tabular-nums ${group.kind === 'expense' && group.remaining_cents < 0 ? 'text-rose-600' : ''}`}
            >
              {formatCents(group.remaining_cents)}
            </div>
            <div />
          </div>
          {group.lines.map((line) => (
            <Row key={line.category_id} line={line} index={nextIndex()} onCommit={onCommit} />
          ))}
        </div>
      ))}
    </section>
  )
}

function Row({
  line,
  index,
  onCommit,
}: {
  line: PlanLine
  index: number
  onCommit: (line: PlanLine, cents: number) => void
}) {
  const share = progress(line.planned_cents, line.actual_cents)
  const bar =
    line.kind === 'income'
      ? 'bg-emerald-500'
      : line.overspent
        ? 'bg-rose-500'
        : share > 0.9
          ? 'bg-amber-500'
          : 'bg-sky-500'
  return (
    <div
      className={`${GRID} px-2 py-1 text-sm ${line.overspent ? 'bg-rose-50 dark:bg-rose-950/30' : ''}`}
      data-testid={`line-${line.name}`}
      data-overspent={line.overspent}
    >
      <div className="truncate pl-3">
        {line.name}
        {line.is_sinking_fund && (
          <span className="ml-1.5 text-xs text-slate-400">sinking fund</span>
        )}
        {line.is_hidden && <span className="ml-1.5 text-xs text-slate-400">hidden</span>}
        {line.committed_cents > 0 && (
          <span
            className="ml-1.5 text-xs text-slate-400"
            title="Bills due this period from Subscriptions"
            data-testid={`committed-${line.name}`}
          >
            {formatCents(line.committed_cents)} in bills
          </span>
        )}
      </div>
      <PlannedInput line={line} index={index} onCommit={onCommit} />
      <div className="text-right tabular-nums">{formatCents(line.actual_cents)}</div>
      <div
        className={`text-right tabular-nums ${line.overspent ? 'font-medium text-rose-600' : ''}`}
        data-testid={`remaining-${line.name}`}
      >
        {formatCents(line.remaining_cents)}
      </div>
      <div
        className="h-2 overflow-hidden rounded bg-slate-200 dark:bg-slate-800"
        role="progressbar"
        aria-label={`${line.name} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
      >
        <div className={`h-full ${bar}`} style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  )
}

const PLAN_INPUT =
  'h-7 w-full rounded border border-transparent bg-transparent px-1.5 text-sm outline-none ' +
  'hover:border-slate-300 focus:border-sky-500 focus:bg-white focus:ring-1 focus:ring-sky-500 ' +
  'dark:hover:border-slate-700 dark:focus:bg-slate-950'

function focusPlanInput(index: number): boolean {
  const target = document.querySelector<HTMLInputElement>(`[data-plan-index="${index}"]`)
  if (!target) return false
  target.focus()
  return true
}

/** A planned amount, edited in place. Tab or Enter commits and moves on; Esc reverts. */
function PlannedInput({
  line,
  index,
  onCommit,
}: {
  line: PlanLine
  index: number
  onCommit: (line: PlanLine, cents: number) => void
}) {
  const toast = useToast()
  // Null while not editing, so the field always shows the latest planned amount.
  const [text, setText] = useState<string | null>(null)
  // A ref, not state: Esc sets it and blurs in the same handler, before a re-render.
  const skipCommit = useRef(false)

  function commit() {
    if (skipCommit.current) {
      skipCommit.current = false
      setText(null)
      return
    }
    if (text === null) return
    const cents = text.trim() === '' ? 0 : evaluateAmount(text)
    setText(null)
    if (cents === null || cents < 0) {
      toast('A planned amount is zero or more.')
      return
    }
    if (cents !== line.planned_cents) onCommit(line, cents)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      // Moving focus commits this field through its blur.
      if (!focusPlanInput(event.shiftKey ? index - 1 : index + 1)) event.currentTarget.blur()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      skipCommit.current = true
      event.currentTarget.blur()
    }
  }

  return (
    <div
      onBlur={commit}
      onFocus={(event: FocusEvent<HTMLDivElement>) => {
        // Swap "$400.00" for the editable "400.00", then select it for overtyping.
        flushSync(() => setText(centsToInput(line.planned_cents)))
        ;(event.target as HTMLInputElement).select()
      }}
    >
      <AmountInput
        aria-label={`Planned for ${line.name}`}
        data-plan-index={index}
        value={text ?? formatCents(line.planned_cents)}
        onChange={setText}
        onKeyDown={handleKeyDown}
        className={PLAN_INPUT}
      />
    </div>
  )
}
