import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

import { updateAccount } from '../../api/accounts'
import type { Account } from '../../api/accounts'
import { ApiRequestError } from '../../api/client'
import { queryKeys } from '../../api/keys'
import { AmountInput } from '../../components/AmountInput'
import { useToast } from '../../components/toastContext'
import { evaluateAmount } from '../../lib/amountExpr'
import { formatCents } from '../../lib/money'
import { centsToInput } from '../ledger/draft'

/** "Warn below": the account's low-balance alert threshold (SPEC §10). Empty turns it off.
 *
 * Enter or leaving the field saves; Esc puts the old value back.
 */
export function LowBalanceField({ account }: { account: Account }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const saved = account.low_balance_alert_cents
  const [text, setText] = useState<string | null>(null)
  const skip = useRef(false)

  const save = useMutation({
    mutationFn: (cents: number | null) =>
      updateAccount(account.id, { low_balance_alert_cents: cents }),
    onMutate: async (cents) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.accounts })
      const before = queryClient.getQueryData<{ items: Account[] }>(queryKeys.accounts)
      if (before) {
        queryClient.setQueryData(queryKeys.accounts, {
          items: before.items.map((row) =>
            row.id === account.id ? { ...row, low_balance_alert_cents: cents } : row,
          ),
        })
      }
      return { before }
    },
    onError: (error, _cents, context) => {
      if (context?.before) queryClient.setQueryData(queryKeys.accounts, context.before)
      toast(error instanceof ApiRequestError ? error.detail : 'Could not save the alert.')
    },
    onSuccess: (updated) => {
      toast(
        updated.low_balance_alert_cents === null
          ? `No low-balance alert for ${updated.name}.`
          : `${updated.name} will alert below ${formatCents(updated.low_balance_alert_cents)}.`,
        'success',
      )
    },
  })

  function commit() {
    if (skip.current) {
      skip.current = false
      setText(null)
      return
    }
    if (text === null) return
    const cents = text.trim() === '' ? null : evaluateAmount(text)
    setText(null)
    if (text.trim() !== '' && cents === null) {
      toast('That amount is not a number.')
      return
    }
    if (cents !== saved) save.mutate(cents)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.currentTarget.blur()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      skip.current = true
      event.currentTarget.blur()
    }
  }

  return (
    <label className="block w-28 text-right" onBlur={commit}>
      <span className="sr-only">Warn when {account.name} is below</span>
      <AmountInput
        aria-label={`Warn when ${account.name} is below`}
        placeholder="warn below"
        value={text ?? (saved === null ? '' : centsToInput(saved))}
        onChange={setText}
        onKeyDown={onKeyDown}
        className="h-7 w-full rounded border border-transparent bg-transparent px-1.5 text-xs outline-none hover:border-slate-300 focus:border-sky-500 focus:bg-white dark:hover:border-slate-700 dark:focus:bg-slate-950"
      />
    </label>
  )
}
