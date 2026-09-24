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
import { parseApr } from '../../lib/apr'
import { centsToInput } from '../ledger/draft'

const FIELD =
  'w-20 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-right text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:bg-slate-950'

type Patch = { apr_bps?: number | null; min_payment_cents?: number | null }

/** APR and minimum payment on a debt account, for the payoff planner (SPEC §3, §14).
 *
 * Enter or leaving a field saves; Esc puts the old value back; empty clears it.
 */
export function DebtFields({ account }: { account: Account }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [aprText, setAprText] = useState<string | null>(null)
  const [minText, setMinText] = useState<string | null>(null)
  const skip = useRef(false)

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
      toast(error instanceof ApiRequestError ? error.detail : 'Could not save that.')
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.debtPlan }),
  })

  function commitApr() {
    if (skip.current || aprText === null) {
      skip.current = false
      setAprText(null)
      return
    }
    const bps = parseApr(aprText)
    setAprText(null)
    if (bps === undefined) {
      toast('Type the APR as a percent, e.g. 19.99.')
      return
    }
    if (bps !== account.apr_bps) save.mutate({ apr_bps: bps })
  }

  function commitMin() {
    if (skip.current || minText === null) {
      skip.current = false
      setMinText(null)
      return
    }
    const cents = minText.trim() === '' ? null : evaluateAmount(minText)
    setMinText(null)
    if (minText.trim() !== '' && (cents === null || cents < 0)) {
      toast('That minimum payment is not an amount.')
      return
    }
    if (cents !== account.min_payment_cents) save.mutate({ min_payment_cents: cents })
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

  const aprShown = aprText ?? (account.apr_bps === null ? '' : centsToInput(account.apr_bps))
  const minShown =
    minText ?? (account.min_payment_cents === null ? '' : centsToInput(account.min_payment_cents))

  return (
    <div className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
      <label className="flex items-center gap-1">
        APR
        <input
          aria-label={`${account.name} APR`}
          inputMode="decimal"
          placeholder="%"
          value={aprShown}
          onChange={(event) => setAprText(event.target.value)}
          onBlur={commitApr}
          onKeyDown={onKeyDown}
          className={FIELD}
        />
        %
      </label>
      <label className="flex items-center gap-1" onBlur={commitMin}>
        Min
        <AmountInput
          aria-label={`${account.name} minimum payment`}
          value={minShown}
          onChange={setMinText}
          onKeyDown={onKeyDown}
          className={FIELD}
        />
      </label>
    </div>
  )
}
