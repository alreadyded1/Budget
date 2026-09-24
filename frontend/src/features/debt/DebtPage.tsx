import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'

import { ApiRequestError } from '../../api/client'
import { queryKeys } from '../../api/keys'
import { fetchDebtPlan, fetchSimulation, saveDebtPlan } from '../../api/netWorth'
import type { DebtPlan, Simulation, Strategy } from '../../api/netWorth'
import { AmountInput } from '../../components/AmountInput'
import { useToast } from '../../components/toastContext'
import { evaluateAmount } from '../../lib/amountExpr'
import { formatCents } from '../../lib/money'
import { centsToInput } from '../ledger/draft'
import { centsCsv } from '../reports/csv'
import { ReportTable } from '../reports/ReportTable'

const FIELD =
  'mt-1 w-40 rounded border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:bg-slate-950'
const SMALL =
  'rounded px-1.5 text-xs text-slate-600 outline-none hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-30 dark:text-slate-300 dark:hover:bg-slate-800'

const STRATEGY_LABEL: Record<Strategy, string> = {
  snowball: 'Snowball (smallest balance first)',
  avalanche: 'Avalanche (highest APR first)',
  custom: 'Custom order',
}

function apr(bps: number | null): string {
  return bps === null ? '—' : `${(bps / 100).toFixed(2)}%`
}

function errorText(error: unknown): string {
  return error instanceof ApiRequestError ? error.detail : 'That did not work.'
}

/** Debt payoff planner (SPEC §14): try an extra payment and a strategy, compare, then save. */
export function DebtPage() {
  const plan = useQuery({
    queryKey: queryKeys.debtPlan,
    queryFn: ({ signal }) => fetchDebtPlan(signal),
  })
  if (!plan.data) {
    return plan.error ? (
      <p className="text-sm text-rose-600">{errorText(plan.error)}</p>
    ) : (
      <p className="text-sm text-slate-500">Loading…</p>
    )
  }
  return <Planner plan={plan.data} />
}

function Planner({ plan }: { plan: DebtPlan }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [extraText, setExtraText] = useState(
    plan.extra_monthly_cents ? centsToInput(plan.extra_monthly_cents) : '',
  )
  const [strategy, setStrategy] = useState<Strategy>(plan.strategy)
  const [order, setOrder] = useState<number[]>(() => {
    const ids = plan.debts.map((debt) => debt.account_id)
    const saved = plan.custom_order.filter((id) => ids.includes(id))
    return [...saved, ...ids.filter((id) => !saved.includes(id))]
  })
  const parsed = extraText.trim() ? evaluateAmount(extraText) : 0
  const extra = parsed !== null && parsed >= 0 ? parsed : null
  const customOrder = strategy === 'custom' ? order : plan.custom_order

  const simulation = useQuery({
    queryKey: queryKeys.debtSimulation(extra, strategy, customOrder),
    queryFn: ({ signal }) => fetchSimulation(extra, strategy, customOrder, signal),
    enabled: extra !== null,
    placeholderData: keepPreviousData,
  })

  const save = useMutation({
    mutationFn: () =>
      saveDebtPlan({ strategy, extra_monthly_cents: extra ?? 0, custom_order: order }),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.debtPlan, saved)
      toast('Debt plan saved.', 'success')
    },
    onError: (error) => toast(errorText(error)),
  })

  const names = new Map(plan.debts.map((debt) => [debt.account_id, debt.name]))
  const dirty =
    strategy !== plan.strategy ||
    (extra ?? 0) !== plan.extra_monthly_cents ||
    (strategy === 'custom' && order.join() !== plan.custom_order.join())

  function move(index: number, offset: number) {
    const target = index + offset
    if (target < 0 || target >= order.length) return
    const next = [...order]
    ;[next[index], next[target]] = [next[target], next[index]]
    setOrder(next)
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`[data-order-id="${next[target]}"]`)?.focus(),
    )
  }

  function orderKey(event: KeyboardEvent<HTMLLIElement>, index: number) {
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      move(index, event.key === 'ArrowUp' ? -1 : 1)
    }
  }

  const totalMinimum = plan.debts.reduce((sum, debt) => sum + (debt.min_payment_cents ?? 0), 0)

  return (
    <section className="max-w-5xl">
      <h1 className="text-xl font-semibold tracking-tight">Debt payoff</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        Estimates: interest compounds monthly at APR ÷ 12 and minimum payments stay as entered on
        each account. When a debt is paid off, its minimum rolls on to the next one.
      </p>

      {plan.debts.length === 0 && plan.skipped.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">No debts owing. Nice.</p>
      ) : (
        <table className="mt-4 w-full text-sm" data-testid="debt-table">
          <thead className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800">
            <tr>
              <th className="py-1 pr-3 font-medium">Debt</th>
              <th className="py-1 pr-3 text-right font-medium">Owed</th>
              <th className="py-1 pr-3 text-right font-medium">APR</th>
              <th className="py-1 text-right font-medium">Minimum</th>
            </tr>
          </thead>
          <tbody>
            {plan.debts.map((debt) => (
              <tr
                key={debt.account_id}
                className="border-b border-slate-100 dark:border-slate-800/70"
              >
                <td className="py-1 pr-3">{debt.name}</td>
                <td className="py-1 pr-3 text-right tabular-nums">
                  {formatCents(debt.owed_cents)}
                </td>
                <td className="py-1 pr-3 text-right tabular-nums">{apr(debt.apr_bps)}</td>
                <td className="py-1 text-right tabular-nums">
                  {formatCents(debt.min_payment_cents ?? 0)}
                </td>
              </tr>
            ))}
            {plan.skipped.map((debt) => (
              <tr
                key={debt.account_id}
                className="border-b border-slate-100 text-slate-500 dark:border-slate-800/70"
              >
                <td className="py-1 pr-3">
                  {debt.name}{' '}
                  <Link
                    to="/accounts"
                    className="text-xs text-amber-700 underline dark:text-amber-400"
                  >
                    left out: {debt.reason}
                  </Link>
                </td>
                <td className="py-1 pr-3 text-right tabular-nums">
                  {formatCents(debt.owed_cents)}
                </td>
                <td className="py-1 pr-3 text-right tabular-nums">{apr(debt.apr_bps)}</td>
                <td className="py-1 text-right tabular-nums">
                  {debt.min_payment_cents ? formatCents(debt.min_payment_cents) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {plan.debts.length > 0 && (
        <>
          <div className="mt-6 flex flex-wrap items-start gap-8">
            <label className="text-sm">
              <span className="block text-xs font-medium text-slate-500">Extra each month</span>
              <AmountInput
                aria-label="Extra each month"
                value={extraText}
                onChange={setExtraText}
                className={FIELD}
              />
              <span className="mt-1 block text-xs text-slate-500">
                On top of {formatCents(totalMinimum)} in minimums.
              </span>
              {extra === null && (
                <span className="block text-xs text-rose-600">Type an amount of zero or more.</span>
              )}
            </label>
            <fieldset className="text-sm">
              <legend className="text-xs font-medium text-slate-500">Strategy</legend>
              {(Object.keys(STRATEGY_LABEL) as Strategy[]).map((key) => (
                <label key={key} className="mt-1 flex items-center gap-2">
                  <input
                    type="radio"
                    name="strategy"
                    checked={strategy === key}
                    onChange={() => setStrategy(key)}
                  />
                  {STRATEGY_LABEL[key]}
                </label>
              ))}
            </fieldset>
            {strategy === 'custom' && (
              <div className="text-sm">
                <span className="block text-xs font-medium text-slate-500">
                  Pay off in this order (Alt+↑/↓)
                </span>
                <ol className="mt-1 space-y-1" aria-label="Custom order">
                  {order.map((id, index) => (
                    <li
                      key={id}
                      tabIndex={0}
                      data-order-id={id}
                      onKeyDown={(event) => orderKey(event, index)}
                      className="flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <span className="w-4 text-xs text-slate-400">{index + 1}</span>
                      <span className="flex-1">{names.get(id)}</span>
                      <button
                        type="button"
                        className={SMALL}
                        disabled={index === 0}
                        aria-label={`Move ${names.get(id)} up`}
                        onClick={() => move(index, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className={SMALL}
                        disabled={index === order.length - 1}
                        aria-label={`Move ${names.get(id)} down`}
                        onClick={() => move(index, 1)}
                      >
                        ↓
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <div className="self-end">
              <button
                type="button"
                disabled={!dirty || extra === null || save.isPending}
                onClick={() => save.mutate()}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
              >
                Save plan
              </button>
            </div>
          </div>

          {simulation.data && <Results data={simulation.data} names={names} chosen={strategy} />}
          {simulation.error && (
            <p className="mt-4 text-sm text-rose-600">{errorText(simulation.error)}</p>
          )}
        </>
      )}
    </section>
  )
}

function Results({
  data,
  names,
  chosen,
}: {
  data: Simulation
  names: Map<number, string>
  chosen: Strategy
}) {
  const debtIds = [...names.keys()]
  const schedule = data.schedule
  const first = schedule[0]?.month ?? ''
  const last = schedule[schedule.length - 1]?.month ?? ''
  return (
    <>
      <h2 className="mt-8 text-sm font-semibold">Side by side</h2>
      <div className="overflow-x-auto">
        <table className="mt-2 w-full text-sm" data-testid="strategy-comparison">
          <thead className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800">
            <tr>
              <th className="py-1 pr-3 font-medium">Strategy</th>
              <th className="py-1 pr-3 font-medium">Debt-free</th>
              <th className="py-1 pr-3 text-right font-medium">Months</th>
              <th className="py-1 pr-3 text-right font-medium">Interest</th>
              <th className="py-1 pr-3 text-right font-medium">Total paid</th>
              {debtIds.map((id) => (
                <th key={id} className="py-1 pr-3 text-right font-medium">
                  {names.get(id)} paid off
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.strategies.map((row) => (
              <tr
                key={row.strategy}
                className={`border-b border-slate-100 dark:border-slate-800/70 ${row.strategy === chosen ? 'bg-sky-50 font-medium dark:bg-sky-950/40' : ''}`}
                data-testid={`strategy-${row.strategy}`}
              >
                <td className="py-1 pr-3">
                  {STRATEGY_LABEL[row.strategy].split(' (')[0]}
                  {row.strategy === chosen && (
                    <span className="ml-1 text-xs text-sky-700 dark:text-sky-300">
                      (shown below)
                    </span>
                  )}
                </td>
                <td className="py-1 pr-3">
                  {row.finished ? row.debt_free : 'Not within 50 years'}
                </td>
                <td className="py-1 pr-3 text-right tabular-nums">{row.months}</td>
                <td className="py-1 pr-3 text-right tabular-nums">
                  {formatCents(row.total_interest_cents)}
                </td>
                <td className="py-1 pr-3 text-right tabular-nums">
                  {formatCents(row.total_paid_cents)}
                </td>
                {debtIds.map((id) => (
                  <td key={id} className="py-1 pr-3 text-right tabular-nums">
                    {row.payoffs.find((p) => p.account_id === id)?.month ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 text-sm font-semibold">
        Month by month
        {data.schedule_strategy ? `: ${STRATEGY_LABEL[data.schedule_strategy].split(' (')[0]}` : ''}
      </h2>
      <ReportTable
        report="debt-schedule"
        range={{ start: first, end: last }}
        rows={schedule}
        rowKey={(row) => row.index}
        columns={[
          { header: 'Month', cell: (row) => row.month, csv: (row) => row.month },
          ...debtIds.flatMap((id) => [
            {
              header: `${names.get(id)} payment`,
              cell: (row: Simulation['schedule'][number]) => {
                const line = row.lines.find((l) => l.account_id === id)
                return line && line.payment_cents ? formatCents(line.payment_cents) : ''
              },
              csv: (row: Simulation['schedule'][number]) =>
                centsCsv(row.lines.find((l) => l.account_id === id)?.payment_cents ?? 0),
              align: 'right' as const,
            },
            {
              header: `${names.get(id)} left`,
              cell: (row: Simulation['schedule'][number]) =>
                formatCents(row.lines.find((l) => l.account_id === id)?.balance_cents ?? 0),
              csv: (row: Simulation['schedule'][number]) =>
                centsCsv(row.lines.find((l) => l.account_id === id)?.balance_cents ?? 0),
              align: 'right' as const,
            },
          ]),
          {
            header: 'Interest',
            cell: (row) => formatCents(row.lines.reduce((sum, l) => sum + l.interest_cents, 0)),
            csv: (row) => centsCsv(row.lines.reduce((sum, l) => sum + l.interest_cents, 0)),
            align: 'right',
          },
        ]}
      />
    </>
  )
}
