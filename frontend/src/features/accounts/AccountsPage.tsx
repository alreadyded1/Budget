import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { createAccount, fetchAccounts, setAccountClosed } from '../../api/accounts'
import type { Account, AccountType } from '../../api/accounts'
import { ApiRequestError } from '../../api/client'
import { queryKeys } from '../../api/keys'
import { fetchBalances } from '../../api/transactions'
import { useToast } from '../../components/toastContext'
import { DebtFields } from './DebtFields'
import { LowBalanceField } from './LowBalanceField'
import { ValuationPanel } from './ValuationPanel'
import { formatCents, parseAmountToCents } from '../../lib/money'

const inputClass =
  'rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:bg-slate-950'

const TYPES: { value: AccountType; label: string }[] = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'credit_card', label: 'Credit card' },
  { value: 'cash', label: 'Cash' },
  { value: 'loan', label: 'Loan' },
  { value: 'mortgage', label: 'Mortgage' },
  { value: 'investment', label: 'Investment' },
  { value: 'other_asset', label: 'Other asset' },
  { value: 'other_liability', label: 'Other liability' },
]

const TYPE_LABEL = Object.fromEntries(TYPES.map((type) => [type.value, type.label]))

/** Types that can be valued by hand instead of by their transactions (SPEC §3). */
const MANUAL_TYPES = new Set<AccountType>(['investment', 'other_asset', 'other_liability'])

export function AccountsPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const { data, isPending } = useQuery({
    queryKey: queryKeys.accounts,
    queryFn: ({ signal }) => fetchAccounts(signal),
  })
  const balances = useQuery({
    queryKey: queryKeys.balances,
    queryFn: ({ signal }) => fetchBalances(signal),
  })
  const balanceOf = (id: number) =>
    balances.data?.items.find((row) => row.account_id === id)?.current_cents

  const [name, setName] = useState('')
  const [type, setType] = useState<AccountType>('checking')
  const [opening, setOpening] = useState('')
  const [manual, setManual] = useState(false)
  const [valuing, setValuing] = useState<number | null>(null)
  const [showClosed, setShowClosed] = useState(false)

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.accounts })
    void queryClient.invalidateQueries({ queryKey: queryKeys.balances })
  }

  const add = useMutation({
    mutationFn: createAccount,
    onSuccess: (account) => {
      setName('')
      setOpening('')
      invalidate()
      toast(`${account.name} added.`, 'success')
    },
    onError: (error) =>
      toast(error instanceof ApiRequestError ? error.detail : 'Could not add that account.'),
  })

  const toggleClosed = useMutation({
    mutationFn: ({ id, closed }: { id: number; closed: boolean }) => setAccountClosed(id, closed),
    onMutate: async ({ id, closed }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.accounts })
      const previous = queryClient.getQueryData<{ items: Account[] }>(queryKeys.accounts)
      if (previous) {
        queryClient.setQueryData<{ items: Account[] }>(queryKeys.accounts, {
          items: previous.items.map((row) => (row.id === id ? { ...row, is_closed: closed } : row)),
        })
      }
      return { previous }
    },
    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.accounts, context.previous)
      toast(error instanceof ApiRequestError ? error.detail : 'Could not update that account.')
    },
    onSuccess: () => invalidate(),
  })

  if (isPending || !data) return <p className="text-sm text-slate-500">Loading…</p>

  const visible = data.items.filter((account) => showClosed || !account.is_closed)

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cents = parseAmountToCents(opening || '0')
    if (cents === null) {
      toast('That opening balance is not an amount.')
      return
    }
    add.mutate({
      name,
      type,
      opening_balance_cents: cents,
      valuation_mode: manual && MANUAL_TYPES.has(type) ? 'manual' : 'transactions',
    })
  }

  return (
    <section>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Accounts</h1>
        <label className="flex items-center gap-2 text-xs text-slate-500">
          <input
            type="checkbox"
            checked={showClosed}
            onChange={(event) => setShowClosed(event.target.checked)}
          />
          Show closed
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">
          No accounts yet. Add the ones you use day to day.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-200 rounded border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {visible.map((account) => (
            <li key={account.id} className="px-3 py-2">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    <Link
                      to={`/transactions/${account.id}`}
                      className="rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-sky-500"
                    >
                      {account.name}
                    </Link>
                    {account.is_closed ? (
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-500 dark:bg-slate-800">
                        closed
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {TYPE_LABEL[account.type]} · {account.on_budget ? 'on budget' : 'tracking'}
                    {account.last4 ? ` · ••${account.last4}` : ''}
                  </div>
                </div>
                {!account.is_closed &&
                  account.is_liability &&
                  account.valuation_mode === 'transactions' && <DebtFields account={account} />}
                {!account.is_closed && account.valuation_mode === 'transactions' && (
                  <LowBalanceField account={account} />
                )}
                {!account.is_closed && account.valuation_mode === 'manual' && (
                  <button
                    type="button"
                    onClick={() => setValuing(valuing === account.id ? null : account.id)}
                    aria-expanded={valuing === account.id}
                    className="shrink-0 rounded px-2 py-1 text-xs text-sky-700 outline-none hover:bg-sky-50 focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-sky-300 dark:hover:bg-sky-950"
                  >
                    Update value
                  </button>
                )}
                <div className="shrink-0 text-right">
                  <div
                    className={`text-sm tabular-nums ${(balanceOf(account.id) ?? 0) < 0 ? 'text-rose-600' : ''}`}
                  >
                    {formatCents(balanceOf(account.id) ?? account.opening_balance_cents)}
                  </div>
                  <div className="text-xs text-slate-400">
                    {balanceOf(account.id) === undefined ? 'opening' : 'balance'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    toggleClosed.mutate({ id: account.id, closed: !account.is_closed })
                  }
                  className="shrink-0 rounded px-2 py-1 text-xs text-slate-600 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {account.is_closed ? 'Reopen' : 'Close'}
                </button>
              </div>
              {valuing === account.id && (
                <ValuationPanel account={account} onClose={() => setValuing(null)} />
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className="mt-6 max-w-2xl">
        <h2 className="text-sm font-semibold">Add an account</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <input
            aria-label="Account name"
            placeholder="Account name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={inputClass}
          />
          <select
            aria-label="Account type"
            value={type}
            onChange={(event) => setType(event.target.value as AccountType)}
            className={inputClass}
          >
            {TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            aria-label="Opening balance"
            placeholder="Opening balance"
            inputMode="decimal"
            value={opening}
            onChange={(event) => setOpening(event.target.value)}
            className={inputClass}
          />
        </div>
        {MANUAL_TYPES.has(type) && (
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={manual}
              onChange={(event) => setManual(event.target.checked)}
            />
            I will type its value in by hand (a house, a car, a brokerage account)
          </label>
        )}
        <button
          type="submit"
          disabled={add.isPending}
          className="mt-3 rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
        >
          Add account
        </button>
      </form>
    </section>
  )
}
