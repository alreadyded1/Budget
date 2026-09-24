import { useEffect, useState } from 'react'
import type { Ref } from 'react'

import type { Payee } from '../../api/payees'
import type { LedgerFilters, TransactionStatus } from '../../api/transactions'
import { AmountInput } from '../../components/AmountInput'
import { DateInput } from '../../components/DateInput'
import { evaluateAmount } from '../../lib/amountExpr'
import { parseDateInput, todayIso } from '../../lib/dates'
import type { CategoryOption } from './draft'

type Props = {
  onChange: (filters: LedgerFilters) => void
  payees: Payee[]
  categories: CategoryOption[]
  searchRef?: Ref<HTMLInputElement>
}

type Form = {
  text: string
  from: string
  to: string
  categoryId: string
  payeeId: string
  status: string
  min: string
  max: string
}

const EMPTY: Form = {
  text: '',
  from: '',
  to: '',
  categoryId: '',
  payeeId: '',
  status: '',
  min: '',
  max: '',
}

const FIELD =
  'h-7 rounded border border-slate-300 bg-white px-1.5 text-sm outline-none focus:border-sky-500 ' +
  'focus:ring-1 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-950'

function toFilters(form: Form): LedgerFilters {
  const today = todayIso()
  const filters: LedgerFilters = {}
  if (form.text.trim()) filters.text = form.text.trim()
  const from = form.from.trim() ? parseDateInput(form.from, today) : null
  const to = form.to.trim() ? parseDateInput(form.to, today) : null
  if (from) filters.from = from
  if (to) filters.to = to
  if (form.categoryId) filters.categoryId = Number(form.categoryId)
  if (form.payeeId) filters.payeeId = Number(form.payeeId)
  if (form.status) filters.status = form.status as TransactionStatus
  const min = form.min.trim() ? evaluateAmount(form.min) : null
  const max = form.max.trim() ? evaluateAmount(form.max) : null
  if (min !== null) filters.minCents = min
  if (max !== null) filters.maxCents = max
  return filters
}

/** Search and filters (SPEC §7). Filtering happens on the server, a moment after typing stops. */
export function FilterBar({ onChange, payees, categories, searchRef }: Props) {
  const [form, setForm] = useState<Form>(EMPTY)
  const set = (patch: Partial<Form>) => setForm((current) => ({ ...current, ...patch }))

  useEffect(() => {
    const timer = window.setTimeout(() => onChange(toFilters(form)), 250)
    return () => window.clearTimeout(timer)
  }, [form, onChange])

  const active = JSON.stringify(form) !== JSON.stringify(EMPTY)

  return (
    <div
      className="mb-2 flex flex-wrap items-center gap-1.5"
      role="search"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.isDefaultPrevented()) {
          // Esc leaves the search so the row shortcuts work again.
          ;(event.target as HTMLElement).blur()
        }
      }}
    >
      <input
        ref={searchRef}
        type="search"
        aria-label="Search payee and memo"
        placeholder="Search  ( / )"
        value={form.text}
        onChange={(event) => set({ text: event.target.value })}
        className={`${FIELD} w-48`}
      />
      <div className="w-32">
        <DateInput
          aria-label="From date"
          placeholder="From"
          value={form.from}
          onChange={(from) => set({ from })}
          className={`${FIELD} w-full`}
        />
      </div>
      <div className="w-32">
        <DateInput
          aria-label="To date"
          placeholder="To"
          value={form.to}
          onChange={(to) => set({ to })}
          className={`${FIELD} w-full`}
        />
      </div>
      <select
        aria-label="Category filter"
        value={form.categoryId}
        onChange={(event) => set({ categoryId: event.target.value })}
        className={FIELD}
      >
        <option value="">All categories</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.groupName}: {category.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Payee filter"
        value={form.payeeId}
        onChange={(event) => set({ payeeId: event.target.value })}
        className={`${FIELD} max-w-40`}
      >
        <option value="">All payees</option>
        {payees.map((payee) => (
          <option key={payee.id} value={payee.id}>
            {payee.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Status filter"
        value={form.status}
        onChange={(event) => set({ status: event.target.value })}
        className={FIELD}
      >
        <option value="">Any status</option>
        <option value="uncleared">Uncleared</option>
        <option value="cleared">Cleared</option>
        <option value="reconciled">Reconciled</option>
      </select>
      <div className="w-24" title="Signed: outflows are negative">
        <AmountInput
          aria-label="Minimum amount"
          placeholder="Min"
          value={form.min}
          onChange={(min) => set({ min })}
          className={`${FIELD} w-full`}
        />
      </div>
      <div className="w-24" title="Signed: outflows are negative">
        <AmountInput
          aria-label="Maximum amount"
          placeholder="Max"
          value={form.max}
          onChange={(max) => set({ max })}
          className={`${FIELD} w-full`}
        />
      </div>
      {active && (
        <button
          type="button"
          onClick={() => setForm(EMPTY)}
          className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}
