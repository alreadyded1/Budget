import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'

import type { Account } from '../../api/accounts'
import { fetchGroups } from '../../api/categories'
import { ApiRequestError } from '../../api/client'
import {
  applySuggestedContribution,
  createGoal,
  deleteGoal,
  fetchGoals,
  updateGoal,
} from '../../api/goals'
import type { Goal, GoalInput, GoalStatus } from '../../api/goals'
import { queryKeys } from '../../api/keys'
import { AmountInput } from '../../components/AmountInput'
import { Combobox } from '../../components/Combobox'
import type { ComboOption } from '../../components/Combobox'
import { DateInput } from '../../components/DateInput'
import { useToast } from '../../components/toastContext'
import { todayIso } from '../../lib/dates'
import { formatCents } from '../../lib/money'
import { useReferenceData } from '../ledger/useLedgerData'
import { buildGoal, emptyForm, formFromGoal } from './goalForm'
import type { GoalFormState } from './goalForm'

const LABEL = 'block text-xs font-medium text-slate-500'
const FIELD =
  'mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:bg-slate-950'
const PRIMARY =
  'rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900'
const SMALL =
  'rounded px-2 py-0.5 text-xs text-slate-600 outline-none hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800'

/** Status is spelled out as well as coloured, so it never rests on colour alone. */
const STATUS: Record<GoalStatus, { label: string; tone: string }> = {
  done: { label: '✓ Reached', tone: 'text-emerald-700 dark:text-emerald-400' },
  on_track: { label: '● On track', tone: 'text-emerald-700 dark:text-emerald-400' },
  behind: { label: '▲ Behind', tone: 'text-amber-700 dark:text-amber-400' },
  no_target: { label: 'No target date', tone: 'text-slate-500' },
}

function errorText(error: unknown): string {
  return error instanceof ApiRequestError ? error.detail : 'That did not work.'
}

/** Goals and sinking funds (SPEC §13). */
export function GoalsPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const reference = useReferenceData()
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const listKey = queryKeys.goalList(showArchived)

  const goals = useQuery({
    queryKey: listKey,
    queryFn: ({ signal }) => fetchGoals(showArchived, signal),
  })
  const groups = useQuery({
    queryKey: queryKeys.categoryGroups,
    queryFn: ({ signal }) => fetchGroups(signal),
  })
  const expenseCategories = useMemo<ComboOption[]>(
    () =>
      (groups.data?.items ?? [])
        .filter((group) => group.kind !== 'income' && !group.is_hidden)
        .flatMap((group) =>
          group.categories
            .filter((category) => !category.is_hidden)
            .map((category) => ({
              key: String(category.id),
              label: category.name,
              group: group.name,
            })),
        ),
    [groups.data],
  )
  const assetAccounts = reference.accounts.filter(
    (account) => !account.is_liability && !account.is_closed,
  )

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.goals })
    // Creating a fund flags its category; the planner shows fund balances.
    void queryClient.invalidateQueries({ queryKey: queryKeys.categoryGroups })
    void queryClient.invalidateQueries({ queryKey: queryKeys.budgets })
  }

  const save = useMutation({
    mutationFn: ({ id, body }: { id: number | null; body: GoalInput }) =>
      id === null ? createGoal(body) : updateGoal(id, body),
    onSuccess: (goal) => {
      setEditing(null)
      refresh()
      toast(`Saved “${goal.name}”.`, 'success')
    },
    onError: (error) => toast(errorText(error)),
  })

  const archive = useMutation({
    mutationFn: (goal: Goal) => updateGoal(goal.id, { is_archived: !goal.is_archived }),
    onMutate: async (goal) => {
      await queryClient.cancelQueries({ queryKey: listKey })
      const previous = queryClient.getQueryData<{ items: Goal[] }>(listKey)
      if (previous && !showArchived) {
        queryClient.setQueryData(listKey, {
          items: previous.items.filter((item) => item.id !== goal.id),
        })
      }
      return { previous }
    },
    onError: (error, _goal, context) => {
      if (context?.previous) queryClient.setQueryData(listKey, context.previous)
      toast(errorText(error))
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.goals }),
  })

  const remove = useMutation({
    mutationFn: (goal: Goal) => deleteGoal(goal.id),
    onMutate: async (goal) => {
      await queryClient.cancelQueries({ queryKey: listKey })
      const previous = queryClient.getQueryData<{ items: Goal[] }>(listKey)
      if (previous)
        queryClient.setQueryData(listKey, {
          items: previous.items.filter((item) => item.id !== goal.id),
        })
      return { previous }
    },
    onError: (error, _goal, context) => {
      if (context?.previous) queryClient.setQueryData(listKey, context.previous)
      toast(errorText(error))
    },
    onSuccess: () => refresh(),
  })

  const suggest = useMutation({
    mutationFn: (goal: Goal) => applySuggestedContribution(goal.id),
    onSuccess: (goal) => {
      queryClient.setQueryData<{ items: Goal[] }>(listKey, (current) =>
        current
          ? { items: current.items.map((item) => (item.id === goal.id ? goal : item)) }
          : current,
      )
      refresh()
      toast(`Planned ${formatCents(goal.current_planned_cents ?? 0)} this pay period.`, 'success')
    },
    onError: (error) => toast(errorText(error)),
  })

  const categoryName = (id: number | null) =>
    id === null ? '' : (reference.categoryNames.get(id) ?? '?')
  const accountName = (id: number | null) =>
    reference.accounts.find((account) => account.id === id)?.name ?? '?'

  function form(goal: Goal | null) {
    return (
      <GoalForm
        initial={
          goal
            ? formFromGoal(goal, categoryName(goal.category_id))
            : emptyForm('sinking_fund', todayIso())
        }
        editing={goal !== null}
        accounts={assetAccounts}
        categories={expenseCategories}
        busy={save.isPending}
        onSave={(body) => save.mutate({ id: goal?.id ?? null, body })}
        onCancel={() => setEditing(null)}
      />
    )
  }

  if (goals.isPending || reference.loading)
    return <p className="text-sm text-slate-500">Loading…</p>
  const items = goals.data?.items ?? []

  return (
    <section className="max-w-4xl">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Goals</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            Show archived
          </label>
          {editing === null && (
            <button type="button" className={PRIMARY} onClick={() => setEditing('new')}>
              Add goal
            </button>
          )}
        </div>
      </div>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        A <strong>sinking fund</strong> saves inside a budget category and carries its balance from
        one pay period to the next. A <strong>savings goal</strong> tracks an account's balance.
      </p>

      {editing === 'new' && <div className="mt-4">{form(null)}</div>}
      {items.length === 0 && editing !== 'new' && (
        <p className="mt-6 text-sm text-slate-500">No goals yet.</p>
      )}

      <ul className="mt-4 grid gap-3" aria-label="Goals">
        {items.map((goal) =>
          editing === goal.id ? (
            <li key={goal.id}>{form(goal)}</li>
          ) : (
            <GoalCard
              key={goal.id}
              goal={goal}
              linked={
                goal.type === 'savings'
                  ? accountName(goal.account_id)
                  : categoryName(goal.category_id)
              }
              planCategory={goal.type === 'savings' ? categoryName(goal.category_id) : ''}
              busy={suggest.isPending}
              onSuggest={() => suggest.mutate(goal)}
              onEdit={() => setEditing(goal.id)}
              onArchive={() => archive.mutate(goal)}
              onDelete={() => {
                if (window.confirm(`Delete the goal “${goal.name}”? Its category and plans stay.`))
                  remove.mutate(goal)
              }}
            />
          ),
        )}
      </ul>
    </section>
  )
}

type CardProps = {
  goal: Goal
  linked: string
  planCategory: string
  busy: boolean
  onSuggest: () => void
  onEdit: () => void
  onArchive: () => void
  onDelete: () => void
}

function GoalCard({
  goal,
  linked,
  planCategory,
  busy,
  onSuggest,
  onEdit,
  onArchive,
  onDelete,
}: CardProps) {
  const share = Math.max(0, Math.min(1, goal.progress_cents / goal.target_cents))
  const status = STATUS[goal.status]
  const canSuggest =
    goal.category_id !== null &&
    goal.needed_cents !== null &&
    goal.current_period_id !== null &&
    goal.needed_cents !== goal.current_planned_cents &&
    goal.status !== 'done'
  return (
    <li
      className={`rounded border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 ${goal.is_archived ? 'opacity-60' : ''}`}
      data-testid="goal-card"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-semibold">{goal.name}</h2>
          <p className="text-xs text-slate-500">
            {goal.type === 'sinking_fund' ? `Sinking fund · ${linked}` : `Savings goal · ${linked}`}
            {planCategory && ` · plans into ${planCategory}`}
            {goal.target_date && ` · by ${goal.target_date}`}
            {goal.is_archived && ' · archived'}
          </p>
        </div>
        <span className={`text-sm font-medium ${status.tone}`} data-testid="goal-status">
          {status.label}
        </span>
      </div>

      <div
        className="mt-3 h-2.5 overflow-hidden rounded bg-slate-200 dark:bg-slate-800"
        role="progressbar"
        aria-label={`${goal.name} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
      >
        <div
          className={`h-full rounded ${goal.progress_cents < 0 ? 'bg-rose-500' : 'bg-sky-500'}`}
          style={{ width: `${share * 100}%` }}
        />
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-slate-500">
            {goal.type === 'sinking_fund' ? 'Fund balance' : 'Saved'}
          </dt>
          <dd
            className={`tabular-nums ${goal.progress_cents < 0 ? 'font-medium text-rose-600' : ''}`}
            data-testid="goal-progress"
          >
            {formatCents(goal.progress_cents)} of {formatCents(goal.target_cents)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Still to go</dt>
          <dd className="tabular-nums">{formatCents(goal.remaining_cents)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Needed per pay period</dt>
          <dd className="tabular-nums" data-testid="goal-needed">
            {goal.needed_cents === null
              ? '—'
              : `${formatCents(goal.needed_cents)}${goal.periods_left ? ` × ${goal.periods_left}` : ''}`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">At the current rate</dt>
          <dd className="tabular-nums" data-testid="goal-projected">
            {goal.status === 'done'
              ? 'Reached'
              : goal.projected_date
                ? `Around ${goal.projected_date}`
                : 'Not at this rate'}
          </dd>
        </div>
      </dl>
      <p className="mt-1 text-xs text-slate-500">
        {goal.current_planned_cents !== null &&
          `This pay period plans ${formatCents(goal.current_planned_cents)}. `}
        {goal.type === 'savings' &&
          `Recent change: ${formatCents(goal.rate_cents)} per pay period.`}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {canSuggest && (
          <button
            type="button"
            disabled={busy}
            onClick={onSuggest}
            className="rounded border border-sky-300 px-2 py-1 text-xs text-sky-800 outline-none hover:bg-sky-50 focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-sky-800 dark:text-sky-200 dark:hover:bg-sky-950"
          >
            Use suggested contribution ({formatCents(goal.needed_cents ?? 0)})
          </button>
        )}
        <button type="button" className={SMALL} onClick={onEdit}>
          Edit
        </button>
        <button type="button" className={SMALL} onClick={onArchive}>
          {goal.is_archived ? 'Unarchive' : 'Archive'}
        </button>
        <button
          type="button"
          className={`${SMALL} text-rose-600 dark:text-rose-400`}
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </li>
  )
}

type FormProps = {
  initial: GoalFormState
  editing: boolean
  accounts: Account[]
  categories: ComboOption[]
  busy: boolean
  onSave: (body: GoalInput) => void
  onCancel: () => void
}

/** Add or edit a goal. Tab through; Enter saves from any field; Esc cancels. */
function GoalForm({ initial, editing, accounts, categories, busy, onSave, onCancel }: FormProps) {
  const [form, setForm] = useState<GoalFormState>(initial)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<GoalFormState>) => setForm((current) => ({ ...current, ...patch }))
  const fund = form.type === 'sinking_fund'

  function save() {
    const built = buildGoal(form)
    if (typeof built === 'string') {
      setError(built)
      return
    }
    setError(null)
    onSave(built)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.isDefaultPrevented()) return
    const target = event.target as HTMLElement
    if (event.key === 'Enter' && target.tagName !== 'BUTTON' && target.tagName !== 'TEXTAREA') {
      event.preventDefault()
      if (!busy) save()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    }
  }

  return (
    <div
      role="group"
      aria-label={editing ? 'Edit goal' : 'New goal'}
      className="rounded border border-sky-200 bg-sky-50/60 p-4 dark:border-sky-900 dark:bg-sky-950/30"
      onKeyDown={handleKeyDown}
      data-testid="goal-form"
    >
      {!editing && (
        <fieldset className="mb-3 flex gap-4 text-sm">
          <legend className="sr-only">Kind of goal</legend>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="goal-type"
              checked={fund}
              onChange={() => set({ type: 'sinking_fund', accountId: null })}
            />
            Sinking fund
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="goal-type"
              checked={!fund}
              onChange={() => set({ type: 'savings' })}
            />
            Savings goal
          </label>
        </fieldset>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <label>
          <span className={LABEL}>Name</span>
          <input
            aria-label="Goal name"
            autoFocus
            value={form.name}
            onChange={(event) => set({ name: event.target.value })}
            className={FIELD}
          />
        </label>
        <label>
          <span className={LABEL}>Target amount</span>
          <AmountInput
            aria-label="Target amount"
            value={form.target}
            onChange={(target) => set({ target })}
            className={FIELD}
          />
        </label>
        <label>
          <span className={LABEL}>Target date (optional)</span>
          <DateInput
            aria-label="Target date"
            value={form.targetDate}
            onChange={(targetDate) => set({ targetDate })}
            placeholder="none"
            className={FIELD}
          />
        </label>
        {!fund && (
          <label>
            <span className={LABEL}>Account</span>
            <select
              aria-label="Goal account"
              value={form.accountId ?? ''}
              onChange={(event) =>
                set({ accountId: event.target.value ? Number(event.target.value) : null })
              }
              className={FIELD}
            >
              <option value="">Pick an account…</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div>
          <span className={LABEL}>{fund ? 'Category' : 'Plan category (optional)'}</span>
          <Combobox
            aria-label={fund ? 'Fund category' : 'Plan category'}
            options={categories}
            text={form.categoryText}
            onTextChange={(categoryText) => set({ categoryText, categoryId: null })}
            onPick={(option) => set({ categoryText: option.label, categoryId: Number(option.key) })}
            className={FIELD}
          />
        </div>
        <label>
          <span className={LABEL}>{fund ? 'Already set aside' : 'Not for this goal'}</span>
          <AmountInput
            aria-label="Starting amount"
            value={form.starting}
            onChange={(starting) => set({ starting })}
            className={FIELD}
          />
        </label>
        <label>
          <span className={LABEL}>Counting from</span>
          <DateInput
            aria-label="Start date"
            value={form.startDate}
            onChange={(startDate) => set({ startDate })}
            className={FIELD}
          />
        </label>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {fund
          ? 'The fund counts every plan and every purchase in its category from the start of that pay period.'
          : 'Progress is the account balance minus the part that is not for this goal. A plan category lets “Use suggested contribution” fill your plan.'}
      </p>
      <label className="mt-3 block">
        <span className={LABEL}>Notes</span>
        <textarea
          aria-label="Notes"
          rows={2}
          value={form.notes}
          onChange={(event) => set({ notes: event.target.value })}
          className={FIELD}
        />
      </label>
      {error && (
        <p role="alert" className="mt-2 text-sm text-rose-600">
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button type="button" className={PRIMARY} disabled={busy} onClick={save}>
          {editing ? 'Save goal' : 'Add goal'}
        </button>
        <button type="button" className={SMALL} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
