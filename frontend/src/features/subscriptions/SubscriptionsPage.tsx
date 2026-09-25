import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { ApiRequestError } from '../../api/client'
import { queryKeys } from '../../api/keys'
import { createPayee } from '../../api/payees'
import {
  createSubscription,
  deleteSubscription,
  describeFrequency,
  fetchSubscriptions,
  updateSubscription,
} from '../../api/subscriptions'
import type {
  Subscription,
  SubscriptionInput,
  SubscriptionList,
  SubscriptionStatus,
} from '../../api/subscriptions'
import { useToast } from '../../components/toastContext'
import { formatCents } from '../../lib/money'
import { useReferenceData } from '../ledger/useLedgerData'
import { SubscriptionForm } from './SubscriptionForm'
import { buildForm, emptyForm, formFrom } from './formState'
import type { FormState } from './formState'

type SortKey = 'name' | 'next' | 'payee' | 'amount' | 'frequency' | 'monthly'

function errorText(error: unknown): string {
  return error instanceof ApiRequestError ? error.detail : 'That did not save.'
}

/** Subscriptions and bills (SPEC §9): the list, totals, and the add/edit form. */
export function SubscriptionsPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const reference = useReferenceData()
  const list = useQuery({
    queryKey: queryKeys.subscriptions,
    queryFn: ({ signal }) => fetchSubscriptions(signal),
  })
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({
    key: 'next',
    descending: false,
  })
  const [editing, setEditing] = useState<Subscription | 'new' | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  const payeeName = (id: number | null) =>
    reference.payees.find((payee) => payee.id === id)?.name ?? ''
  const categoryName = (id: number | null) =>
    id === null ? 'Uncategorized' : (reference.categoryNames.get(id) ?? '—')

  /** Bills feed the calendar, the planner and the dashboard. */
  const refreshOthers = () => {
    for (const key of [queryKeys.bills, queryKeys.budgets, queryKeys.dashboard]) {
      void queryClient.invalidateQueries({ queryKey: key })
    }
  }

  const save = useMutation({
    mutationFn: async ({
      id,
      body,
      newPayeeName,
    }: {
      id: number | null
      body: Partial<SubscriptionInput>
      newPayeeName: string | null
    }) => {
      if (newPayeeName) {
        const payee = await createPayee({ name: newPayeeName })
        body = { ...body, payee_id: payee.id }
        void queryClient.invalidateQueries({ queryKey: queryKeys.payees })
      }
      return id === null
        ? createSubscription(body as SubscriptionInput)
        : updateSubscription(id, body)
    },
    onSuccess: (saved, { id }) => {
      setEditing(null)
      toast(id === null ? `${saved.name} added.` : `${saved.name} saved.`, 'success')
      void queryClient.invalidateQueries({ queryKey: queryKeys.subscriptions })
      refreshOthers()
    },
    onError: (error) => toast(errorText(error)),
  })

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: SubscriptionStatus }) =>
      updateSubscription(id, { status }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.subscriptions })
      const before = queryClient.getQueryData<SubscriptionList>(queryKeys.subscriptions)
      if (before) {
        queryClient.setQueryData<SubscriptionList>(queryKeys.subscriptions, {
          ...before,
          items: before.items.map((item) => (item.id === id ? { ...item, status } : item)),
        })
      }
      return { before }
    },
    onError: (error, _vars, context) => {
      if (context?.before) queryClient.setQueryData(queryKeys.subscriptions, context.before)
      toast(errorText(error))
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.subscriptions })
      refreshOthers()
    },
  })

  const remove = useMutation({
    mutationFn: (id: number) => deleteSubscription(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.subscriptions })
      const before = queryClient.getQueryData<SubscriptionList>(queryKeys.subscriptions)
      if (before) {
        queryClient.setQueryData<SubscriptionList>(queryKeys.subscriptions, {
          ...before,
          items: before.items.filter((item) => item.id !== id),
        })
      }
      return { before }
    },
    onError: (error, _id, context) => {
      if (context?.before) queryClient.setQueryData(queryKeys.subscriptions, context.before)
      toast(errorText(error))
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.subscriptions })
      refreshOthers()
    },
  })

  function handleSave(form: FormState) {
    const built = buildForm(form, reference.payees, reference.categories)
    if (!built.ok) {
      toast(built.message)
      return
    }
    const id = editing === 'new' || editing === null ? null : editing.id
    const body: Partial<SubscriptionInput> = { ...built.body }
    // Saving an edit never changes whether it is paused or cancelled.
    if (id !== null) delete body.status
    save.mutate({ id, body, newPayeeName: built.newPayeeName })
  }

  const items = useMemo(() => {
    const rows = (list.data?.items ?? []).filter(
      (item) => showInactive || item.status !== 'cancelled',
    )
    const value = (item: Subscription): string | number => {
      switch (sort.key) {
        case 'name':
          return item.name.toLowerCase()
        case 'next':
          return item.next_due_date ?? '9999-12-31'
        case 'payee':
          return payeeName(item.payee_id).toLowerCase()
        case 'amount':
          return item.amount_cents
        case 'frequency':
          return item.monthly_cents === 0 ? 0 : item.amount_cents / item.monthly_cents
        case 'monthly':
          return item.monthly_cents
      }
    }
    return [...rows].sort((a, b) => {
      const left = value(a)
      const right = value(b)
      const order = left < right ? -1 : left > right ? 1 : 0
      return sort.descending ? -order : order
    })
    // payeeName reads reference data that the list does not depend on otherwise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data, sort, showInactive, reference.payees])

  if (list.isPending) return <p className="text-sm text-slate-500">Loading…</p>
  if (list.isError) return <p className="text-sm text-rose-600">{errorText(list.error)}</p>
  const data = list.data

  const header = (key: SortKey, label: string, right = false) => (
    <th
      className={`px-2 py-1.5 font-medium ${right ? 'text-right' : 'text-left'}`}
      aria-sort={sort.key === key ? (sort.descending ? 'descending' : 'ascending') : undefined}
    >
      <button
        type="button"
        onClick={() =>
          setSort((current) => ({
            key,
            descending: current.key === key ? !current.descending : false,
          }))
        }
        className="rounded uppercase outline-none hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-sky-500 dark:hover:text-slate-100"
      >
        {label}
        {sort.key === key ? (sort.descending ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  )

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">Bills &amp; Recurring</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(event) => setShowInactive(event.target.checked)}
            />
            Show cancelled
          </label>
          {editing === null && (
            <button
              type="button"
              onClick={() => setEditing('new')}
              className="rounded bg-sky-700 px-3 py-1.5 text-sm font-medium text-white outline-none hover:bg-sky-800 focus-visible:ring-2 focus-visible:ring-sky-500"
            >
              Add bill
            </button>
          )}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
          <dt className="text-xs text-slate-500">Per month</dt>
          <dd className="text-lg font-semibold tabular-nums" data-testid="monthly-total">
            {formatCents(data.monthly_cents)}
          </dd>
        </div>
        <div className="rounded border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
          <dt className="text-xs text-slate-500">Per year</dt>
          <dd className="text-lg font-semibold tabular-nums" data-testid="annual-total">
            {formatCents(data.annual_cents)}
          </dd>
        </div>
        <div className="col-span-2 rounded border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900">
          <dt className="text-xs text-slate-500">By category (per year)</dt>
          <dd>
            {data.by_category.length === 0 ? (
              <span className="text-slate-400">—</span>
            ) : (
              <ul className="mt-0.5 space-y-0.5">
                {data.by_category.slice(0, 4).map((row) => (
                  <li key={row.category_id ?? 'none'} className="flex justify-between gap-2">
                    <span className="truncate">{categoryName(row.category_id)}</span>
                    <span className="tabular-nums">{formatCents(row.annual_cents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>

      {editing !== null && (
        <div className="mt-4">
          <SubscriptionForm
            key={editing === 'new' ? 'new' : editing.id}
            initial={
              editing === 'new'
                ? emptyForm()
                : formFrom(editing, reference.payees, reference.categories)
            }
            editing={editing !== 'new'}
            accounts={reference.accounts}
            payees={reference.payees}
            categories={reference.categories}
            busy={save.isPending}
            onSave={handleSave}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      {items.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">
          No bills yet. Add the bills, subscriptions and services you pay on a schedule.
        </p>
      ) : (
        <table className="mt-4 w-full text-sm">
          <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-500 dark:border-slate-800">
            <tr>
              {header('name', 'Name')}
              {header('next', 'Next due')}
              {header('payee', 'Payee')}
              {header('amount', 'Amount', true)}
              {header('frequency', 'Repeats')}
              {header('monthly', 'Monthly', true)}
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                className={`border-b border-slate-100 dark:border-slate-800/70 ${item.status !== 'active' ? 'text-slate-400' : ''}`}
                data-testid={`subscription-${item.name}`}
              >
                <td className="px-2 py-1.5">
                  {item.name}
                  {item.status !== 'active' && (
                    <span className="ml-1.5 rounded bg-slate-100 px-1.5 text-xs dark:bg-slate-800">
                      {item.status}
                    </span>
                  )}
                  {item.price_increased && item.previous_amount_cents !== null && (
                    <span
                      className="ml-1.5 rounded bg-rose-100 px-1.5 text-xs text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                      title={`Was ${formatCents(item.previous_amount_cents)}`}
                    >
                      price ↑
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 tabular-nums">{item.next_due_date ?? '—'}</td>
                <td className="px-2 py-1.5">{payeeName(item.payee_id)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {formatCents(item.amount_cents)}
                </td>
                <td className="px-2 py-1.5">{describeFrequency(item)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {formatCents(item.monthly_cents)}
                </td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap">
                  <RowButton label="Edit" onClick={() => setEditing(item)} />
                  {item.status === 'active' ? (
                    <RowButton
                      label="Pause"
                      onClick={() => setStatus.mutate({ id: item.id, status: 'paused' })}
                    />
                  ) : (
                    <RowButton
                      label="Resume"
                      onClick={() => setStatus.mutate({ id: item.id, status: 'active' })}
                    />
                  )}
                  {item.status !== 'cancelled' && (
                    <RowButton
                      label="Cancel"
                      onClick={() => setStatus.mutate({ id: item.id, status: 'cancelled' })}
                    />
                  )}
                  <RowButton
                    label="Delete"
                    onClick={() => {
                      if (window.confirm(`Delete ${item.name}? Its payments stay in the ledger.`)) {
                        remove.mutate(item.id)
                      }
                    }}
                  />
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-1 rounded px-1.5 text-xs text-sky-600 underline outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                    >
                      Manage
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function RowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ml-1 rounded px-1.5 py-0.5 text-xs text-slate-600 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      {label}
    </button>
  )
}
