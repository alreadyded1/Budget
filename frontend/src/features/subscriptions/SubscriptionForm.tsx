import { useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'

import type { Account } from '../../api/accounts'
import type { Payee } from '../../api/payees'
import type { Frequency, IntervalUnit } from '../../api/subscriptions'
import { FREQUENCY_LABEL } from '../../api/subscriptions'
import { AmountInput } from '../../components/AmountInput'
import { Combobox, CREATE_KEY } from '../../components/Combobox'
import type { ComboOption } from '../../components/Combobox'
import { DateInput } from '../../components/DateInput'
import type { CategoryOption } from '../ledger/draft'
import type { FormState } from './formState'

const FIELD =
  'h-8 w-full rounded border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500 ' +
  'focus:ring-1 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-950'
const LABEL = 'block text-xs font-medium text-slate-600 dark:text-slate-300'

type Props = {
  initial: FormState
  editing: boolean
  accounts: Account[]
  payees: Payee[]
  categories: CategoryOption[]
  busy: boolean
  onSave: (form: FormState) => void
  onCancel: () => void
}

/** Add or edit a subscription. Tab through; Enter saves from any field; Esc cancels. */
export function SubscriptionForm({
  initial,
  editing,
  accounts,
  payees,
  categories,
  busy,
  onSave,
  onCancel,
}: Props) {
  const [form, setForm] = useState<FormState>(initial)
  const set = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }))

  const payeeOptions = useMemo<ComboOption[]>(
    () =>
      payees
        .filter((payee) => !payee.is_hidden)
        .map((payee) => ({ key: String(payee.id), label: payee.name })),
    [payees],
  )
  const categoryOptions = useMemo<ComboOption[]>(
    () =>
      categories.map((category) => ({
        key: String(category.id),
        label: category.name,
        group: category.groupName,
      })),
    [categories],
  )

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.isDefaultPrevented()) return
    const target = event.target as HTMLElement
    if (event.key === 'Enter' && target.tagName !== 'TEXTAREA' && target.tagName !== 'BUTTON') {
      event.preventDefault()
      if (!busy) onSave(form)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    }
  }

  return (
    <div
      role="group"
      aria-label={editing ? 'Edit subscription' : 'New subscription'}
      className="rounded border border-sky-200 bg-sky-50/60 p-4 dark:border-sky-900 dark:bg-sky-950/30"
      onKeyDown={handleKeyDown}
      data-testid="subscription-form"
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="sm:col-span-2">
          <span className={LABEL}>Name</span>
          <input
            aria-label="Name"
            autoFocus
            value={form.name}
            onChange={(event) => set({ name: event.target.value })}
            className={FIELD}
          />
        </label>
        <div>
          <span className={LABEL}>Payee</span>
          <Combobox
            aria-label="Payee"
            options={payeeOptions}
            allowCreate
            text={form.payeeText}
            onTextChange={(text) => set({ payeeText: text, payeeId: null })}
            onPick={(option) =>
              set({
                payeeText: option.label,
                payeeId: option.key === CREATE_KEY ? null : Number(option.key),
              })
            }
            className={FIELD}
          />
        </div>
        <div>
          <span className={LABEL}>Category</span>
          <Combobox
            aria-label="Category"
            options={categoryOptions}
            text={form.categoryText}
            onTextChange={(text) => set({ categoryText: text, categoryId: null })}
            onPick={(option) => set({ categoryText: option.label, categoryId: Number(option.key) })}
            className={FIELD}
          />
        </div>
        <label>
          <span className={LABEL}>Amount</span>
          <AmountInput
            aria-label="Amount"
            value={form.amount}
            onChange={(amount) => set({ amount })}
            className={FIELD}
          />
        </label>
        <label>
          <span className={LABEL}>Repeats</span>
          <select
            aria-label="Repeats"
            value={form.frequency}
            onChange={(event) => set({ frequency: event.target.value as Frequency })}
            className={FIELD}
          >
            {(Object.keys(FREQUENCY_LABEL) as Frequency[]).map((key) => (
              <option key={key} value={key}>
                {FREQUENCY_LABEL[key]}
              </option>
            ))}
          </select>
        </label>
        {form.frequency === 'custom' && (
          <div className="flex items-end gap-2">
            <label className="w-16">
              <span className={LABEL}>Every</span>
              <input
                aria-label="Every"
                inputMode="numeric"
                value={form.intervalCount}
                onChange={(event) => set({ intervalCount: event.target.value })}
                className={FIELD}
              />
            </label>
            <label className="flex-1">
              <span className="sr-only">Unit</span>
              <select
                aria-label="Unit"
                value={form.intervalUnit}
                onChange={(event) => set({ intervalUnit: event.target.value as IntervalUnit })}
                className={FIELD}
              >
                <option value="day">days</option>
                <option value="week">weeks</option>
                <option value="month">months</option>
              </select>
            </label>
          </div>
        )}
        <div>
          <span className={LABEL}>{editing ? 'Next due' : 'First due'}</span>
          <DateInput
            aria-label={editing ? 'Next due' : 'First due'}
            value={form.anchor}
            onChange={(anchor) => set({ anchor })}
            className={FIELD}
          />
        </div>
        <div>
          <span className={LABEL}>Ends (optional)</span>
          <DateInput
            aria-label="Ends"
            placeholder="Never"
            value={form.end}
            onChange={(end) => set({ end })}
            className={FIELD}
          />
        </div>
        <label>
          <span className={LABEL}>Paid from</span>
          <select
            aria-label="Paid from"
            value={form.accountId}
            onChange={(event) => set({ accountId: event.target.value })}
            className={FIELD}
          >
            <option value="">—</option>
            {accounts
              .filter((account) => !account.is_closed)
              .map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          <span className={LABEL}>Remind days before</span>
          <input
            aria-label="Remind days before"
            inputMode="numeric"
            value={form.remindDays}
            onChange={(event) => set({ remindDays: event.target.value })}
            className={FIELD}
          />
        </label>
        <label className="flex items-end gap-2 pb-1.5 text-sm">
          <input
            type="checkbox"
            aria-label="Auto-post"
            checked={form.autoPost}
            onChange={(event) => set({ autoPost: event.target.checked })}
          />
          Auto-post on the due date
        </label>
        <label className="sm:col-span-2">
          <span className={LABEL}>Manage / cancel URL</span>
          <input
            aria-label="URL"
            type="url"
            value={form.url}
            onChange={(event) => set({ url: event.target.value })}
            className={FIELD}
            placeholder="https://"
          />
        </label>
        <label className="sm:col-span-4">
          <span className={LABEL}>Notes</span>
          <textarea
            aria-label="Notes"
            value={form.notes}
            onChange={(event) => set({ notes: event.target.value })}
            className={`${FIELD} h-14 py-1`}
          />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onSave(form)}
          className="rounded bg-sky-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
        >
          {editing ? 'Save changes' : 'Add subscription'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
        <span className="text-xs text-slate-400">
          Enter saves · Esc cancels · auto-post takes effect once the daily job exists
        </span>
      </div>
    </div>
  )
}
