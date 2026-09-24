import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { KeyboardEvent } from 'react'

import { addValuation, deleteValuation, fetchValuations } from '../../api/accounts'
import type { Account, Valuation } from '../../api/accounts'
import { ApiRequestError } from '../../api/client'
import { queryKeys } from '../../api/keys'
import { AmountInput } from '../../components/AmountInput'
import { DateInput } from '../../components/DateInput'
import { useToast } from '../../components/toastContext'
import { evaluateAmount } from '../../lib/amountExpr'
import { parseDateInput, todayIso } from '../../lib/dates'
import { formatCents } from '../../lib/money'

const FIELD =
  'mt-1 w-36 rounded border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:bg-slate-950'

/** Typed-in values for a manually valued account (SPEC §3, §14). Enter saves; Esc closes. */
export function ValuationPanel({ account, onClose }: { account: Account; onClose: () => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const key = ['accounts', account.id, 'valuations'] as const
  const [dateText, setDateText] = useState(todayIso())
  const [valueText, setValueText] = useState('')
  const history = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchValuations(account.id, signal),
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.balances })
    void queryClient.invalidateQueries({ queryKey: queryKeys.netWorthAll })
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
  }

  const add = useMutation({
    mutationFn: (body: { date: string; balance_cents: number }) => addValuation(account.id, body),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: key })
      const before = queryClient.getQueryData<{ items: Valuation[] }>(key)
      if (before) {
        const rest = before.items.filter((row) => row.date !== body.date)
        const optimistic = { id: -1, account_id: account.id, note: null, ...body }
        queryClient.setQueryData(key, {
          items: [...rest, optimistic].sort((a, b) => b.date.localeCompare(a.date)),
        })
      }
      return { before }
    },
    onError: (error, _body, context) => {
      if (context?.before) queryClient.setQueryData(key, context.before)
      toast(error instanceof ApiRequestError ? error.detail : 'The value was not saved.')
    },
    onSuccess: () => {
      setValueText('')
      toast(`Updated ${account.name}.`, 'success')
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key })
      refresh()
    },
  })

  const remove = useMutation({
    mutationFn: (row: Valuation) => deleteValuation(account.id, row.id),
    onMutate: async (row) => {
      await queryClient.cancelQueries({ queryKey: key })
      const before = queryClient.getQueryData<{ items: Valuation[] }>(key)
      if (before)
        queryClient.setQueryData(key, { items: before.items.filter((item) => item.id !== row.id) })
      return { before }
    },
    onError: (error, _row, context) => {
      if (context?.before) queryClient.setQueryData(key, context.before)
      toast(error instanceof ApiRequestError ? error.detail : 'That value was not deleted.')
    },
    onSettled: () => refresh(),
  })

  function save() {
    const on = parseDateInput(dateText, todayIso())
    const cents = valueText.trim() ? evaluateAmount(valueText) : null
    if (!on) {
      toast('Type the date of the value.')
      return
    }
    if (cents === null) {
      toast('Type the value.')
      return
    }
    add.mutate({ date: on, balance_cents: cents })
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.isDefaultPrevented()) return
    const target = event.target as HTMLElement
    if (event.key === 'Enter' && target.tagName !== 'BUTTON') {
      event.preventDefault()
      save()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <div
      role="group"
      aria-label={`Values of ${account.name}`}
      onKeyDown={handleKeyDown}
      className="mt-2 rounded border border-sky-200 bg-sky-50/60 p-3 dark:border-sky-900 dark:bg-sky-950/30"
      data-testid="valuation-panel"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-500">
          Date
          <DateInput
            aria-label="Value date"
            value={dateText}
            onChange={setDateText}
            className={FIELD}
          />
        </label>
        <label className="text-xs text-slate-500">
          {account.is_liability ? 'Balance (owed is negative)' : 'Value'}
          <AmountInput
            aria-label="Value"
            value={valueText}
            onChange={setValueText}
            className={FIELD}
          />
        </label>
        <button
          type="button"
          onClick={save}
          disabled={add.isPending}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
        >
          Save value
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Close
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        The latest value on or before a date is the balance for that date. One value per day; a
        second one replaces it.
      </p>
      {history.data && history.data.items.length > 0 && (
        <ul className="mt-2 max-h-48 overflow-auto text-sm" aria-label="Past values">
          {history.data.items.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-3 border-b border-slate-100 py-0.5 dark:border-slate-800"
            >
              <span className="text-slate-500 tabular-nums">{row.date}</span>
              <span className="flex-1 text-right tabular-nums">
                {formatCents(row.balance_cents)}
              </span>
              <button
                type="button"
                disabled={row.id < 0}
                onClick={() => remove.mutate(row)}
                className="rounded px-1.5 text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
