import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'

import { updateAccount } from '../../api/accounts'
import type { Account } from '../../api/accounts'
import { ApiRequestError } from '../../api/client'
import { queryKeys } from '../../api/keys'
import { AmountInput } from '../../components/AmountInput'
import { DateInput } from '../../components/DateInput'
import { useToast } from '../../components/toastContext'
import { evaluateAmount } from '../../lib/amountExpr'
import { parseDateInput, todayIso } from '../../lib/dates'
import { centsToInput } from '../ledger/draft'
import { owedToBalance, tracksOwed } from './owed'

const FIELD =
  'mt-1 w-40 rounded border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:bg-slate-950'

type Patch = { opening_balance_cents: number; opening_date: string }

/** Correct an account's opening balance and date (repair list: a debt entered with the wrong
 * sign). A debt's is typed as the amount owed. Enter saves; Esc closes.
 */
export function OpeningPanel({ account, onClose }: { account: Account; onClose: () => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const owed = tracksOwed(account.type, account.valuation_mode)
  const shown = owed ? Math.abs(account.opening_balance_cents) : account.opening_balance_cents
  const [amountText, setAmountText] = useState(centsToInput(shown))
  const [dateText, setDateText] = useState(account.opening_date)
  const amountRef = useRef<HTMLInputElement>(null)
  useEffect(() => amountRef.current?.focus(), [])

  const save = useMutation({
    mutationFn: (patch: Patch) => updateAccount(account.id, patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.accounts })
      const before = queryClient.getQueryData<{ items: Account[] }>(queryKeys.accounts)
      if (before) {
        queryClient.setQueryData(queryKeys.accounts, {
          items: before.items.map((row) => (row.id === account.id ? { ...row, ...patch } : row)),
        })
      }
      return { before }
    },
    onError: (error, _patch, context) => {
      if (context?.before) queryClient.setQueryData(queryKeys.accounts, context.before)
      toast(error instanceof ApiRequestError ? error.detail : 'The opening balance was not saved.')
    },
    onSuccess: () => {
      toast(`Updated ${account.name}'s opening balance.`, 'success')
      onClose()
    },
    onSettled: () => {
      // Every balance on the account moves with its opening balance.
      void queryClient.invalidateQueries({ queryKey: queryKeys.accounts })
      void queryClient.invalidateQueries({ queryKey: queryKeys.balances })
      void queryClient.invalidateQueries({ queryKey: queryKeys.netWorthAll })
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
      void queryClient.invalidateQueries({ queryKey: queryKeys.debtPlan })
      void queryClient.invalidateQueries({ queryKey: ['transactions'] })
    },
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    const cents = amountText.trim() === '' ? 0 : evaluateAmount(amountText)
    if (cents === null) {
      toast('That is not an amount.')
      return
    }
    const date = parseDateInput(dateText, todayIso())
    if (date === null) {
      toast('That is not a date.')
      return
    }
    save.mutate({
      opening_balance_cents: owed ? owedToBalance(cents) : cents,
      opening_date: date,
    })
  }

  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={onKeyDown}
      aria-label={`Opening balance for ${account.name}`}
      className="mt-2 flex flex-wrap items-end gap-3 rounded bg-slate-50 p-3 text-sm dark:bg-slate-900"
    >
      <label className="text-xs text-slate-600 dark:text-slate-300">
        {owed ? 'Amount owed at opening' : 'Opening balance'}
        <AmountInput
          aria-label={owed ? 'Amount owed at opening' : 'Opening balance'}
          value={amountText}
          onChange={setAmountText}
          className={FIELD}
          inputRef={amountRef}
        />
      </label>
      <label className="text-xs text-slate-600 dark:text-slate-300">
        Opening date
        <DateInput
          aria-label="Opening date"
          value={dateText}
          onChange={setDateText}
          className={FIELD}
        />
      </label>
      <button
        type="submit"
        disabled={save.isPending}
        className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
      >
        Save
      </button>
      <button
        type="button"
        onClick={onClose}
        className="rounded px-2 py-1.5 text-xs text-slate-600 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        Cancel
      </button>
      <p className="basis-full text-xs text-slate-500">
        {owed
          ? 'Type what you owed on the opening date; it is saved as money owed.'
          : 'Negative if the account was overdrawn.'}{' '}
        Every balance on this account moves with it, including reconciled ones.
      </p>
    </form>
  )
}
