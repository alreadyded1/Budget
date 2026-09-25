import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { Fragment, useMemo, useState } from 'react'

import type { Account } from '../../api/accounts'
import { ApiRequestError } from '../../api/client'
import { applyRules, patchRow } from '../../api/imports'
import type { Disposition, ImportBatchDetail, RowPatch, StagedRow } from '../../api/imports'
import { queryKeys } from '../../api/keys'
import type { Payee } from '../../api/payees'
import { EMPTY_RULE } from '../../api/rules'
import { CREATE_KEY, Combobox } from '../../components/Combobox'
import type { ComboOption } from '../../components/Combobox'
import { useToast } from '../../components/toastContext'
import { formatCents } from '../../lib/money'
import type { CategoryOption } from '../ledger/draft'
import { RuleForm } from '../rules/RuleForm'
import { reviewSummary } from './review'
import { useRuleSave } from '../rules/useRuleSave'

const FIELD =
  'w-full min-w-32 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:bg-slate-950'

type Props = {
  batch: ImportBatchDetail
  account: Account | undefined
  accounts: Account[]
  payees: Payee[]
  categories: CategoryOption[]
  categoryNames: Map<number, string>
  busy: boolean
  onCommit: () => void
  onDiscard: () => void
}

/** Review every staged row before anything touches the ledger (SPEC §11). */
export function ReviewStep({
  batch,
  account,
  accounts,
  payees,
  categories,
  categoryNames,
  busy,
  onCommit,
  onDiscard,
}: Props) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const key = queryKeys.importBatch(batch.id)
  const [ruleFor, setRuleFor] = useState<number | null>(null)

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
  const payeeName = (id: number | null) => payees.find((payee) => payee.id === id)?.name ?? ''

  const rowKey = ['imports', 'row', batch.id]
  // Commit waits for row edits still on their way, or it could import without them.
  const saving = useIsMutating({ mutationKey: rowKey }) > 0
  const patch = useMutation({
    mutationKey: rowKey,
    mutationFn: ({ row, change }: { row: StagedRow; change: RowPatch }) =>
      patchRow(batch.id, row.id, change),
    onMutate: async ({ row, change }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<ImportBatchDetail>(key)
      if (previous) {
        queryClient.setQueryData<ImportBatchDetail>(key, {
          ...previous,
          rows: previous.rows.map((item) => (item.id === row.id ? { ...item, ...change } : item)),
        })
      }
      return { previous }
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
      toast(error instanceof ApiRequestError ? error.detail : 'That change was not saved.')
    },
    onSuccess: (saved) => {
      // The server may have found (or dropped) a bill for the new payee.
      queryClient.setQueryData<ImportBatchDetail>(key, (current) =>
        current
          ? { ...current, rows: current.rows.map((item) => (item.id === saved.id ? saved : item)) }
          : current,
      )
    },
  })
  const change = (row: StagedRow, next: RowPatch) => patch.mutate({ row, change: next })

  const saveRule = useRuleSave((rule) => {
    setRuleFor(null)
    // Fill this batch's untouched rows from the new rule too, not only future imports.
    applyRules(batch.id)
      .then((updated) => {
        const filled = updated.rows.filter(
          (row) =>
            row.applied_rule_id === rule.id &&
            batch.rows.find((before) => before.id === row.id)?.applied_rule_id !== rule.id,
        ).length
        queryClient.setQueryData(key, updated)
        toast(
          `Rule “${rule.name}” saved${filled ? ` and filled ${filled} row${filled === 1 ? '' : 's'} here` : ''}.`,
          'success',
        )
      })
      .catch(() => toast(`Rule “${rule.name}” saved. It applies from the next import on.`))
  })

  const summary = reviewSummary(batch.rows)
  const ruleRow = batch.rows.find((row) => row.id === ruleFor)

  return (
    <div data-testid="review-step">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          <span className="font-medium">{batch.filename}</span> into{' '}
          <span className="font-medium">{account?.name ?? 'this account'}</span>: {batch.row_count}{' '}
          rows
          {batch.duplicate_count > 0 && <>, {batch.duplicate_count} already imported</>}
          {batch.matched_count > 0 && <>, {batch.matched_count} match entries you typed</>}. Nothing
          is saved until you commit.
        </p>
      </div>
      {batch.parse_errors.length > 0 && (
        <details className="mt-2 text-sm text-amber-700 dark:text-amber-400">
          <summary>
            {batch.parse_errors.length} line{batch.parse_errors.length === 1 ? '' : 's'} could not
            be read and were left out
          </summary>
          <ul className="mt-1 ml-4 list-disc">
            {batch.parse_errors.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm" data-testid="review-table">
          <thead className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800">
            <tr>
              <th className="py-1 pr-2 font-medium">Action</th>
              <th className="py-1 pr-2 font-medium">Date</th>
              <th className="py-1 pr-2 font-medium">Bank description</th>
              <th className="py-1 pr-2 text-right font-medium">Amount</th>
              <th className="py-1 pr-2 font-medium">Payee</th>
              <th className="py-1 pr-2 font-medium">Category</th>
              <th className="py-1 font-medium" />
            </tr>
          </thead>
          <tbody>
            {batch.rows.map((row) => (
              <Fragment key={row.id}>
                <ReviewRow
                  row={row}
                  payeeText={row.new_payee_name ?? payeeName(row.payee_id)}
                  categoryText={
                    row.category_id === null ? '' : (categoryNames.get(row.category_id) ?? '')
                  }
                  matchPayee={row.match ? payeeName(row.match.payee_id) : ''}
                  payeeOptions={payeeOptions}
                  categoryOptions={categoryOptions}
                  onChange={(next) => change(row, next)}
                  onRule={() => setRuleFor(ruleFor === row.id ? null : row.id)}
                />
                {ruleRow && ruleRow.id === row.id && (
                  <tr>
                    <td colSpan={7} className="py-2">
                      <RuleForm
                        initial={{
                          ...EMPTY_RULE,
                          match_value: row.raw_description,
                          set_payee_id: row.payee_id,
                          set_category_id: row.category_id,
                        }}
                        initialNewPayee={row.new_payee_name}
                        editing={false}
                        accounts={accounts}
                        payees={payees}
                        categories={categories}
                        busy={saveRule.isPending}
                        onSave={(draft) => saveRule.mutate({ id: null, draft })}
                        onCancel={() => setRuleFor(null)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || saving}
          onClick={onCommit}
          title={saving ? 'Saving your changes…' : undefined}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          Commit import
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDiscard}
          className="rounded px-3 py-1.5 text-sm text-slate-600 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Discard
        </button>
        <span className="text-sm text-slate-500" data-testid="review-summary">
          {summary.imported} new, {summary.matched} matched, {summary.skipped} skipped · net{' '}
          <span className="tabular-nums">{formatCents(summary.netCents)}</span>
        </span>
      </div>
    </div>
  )
}

type RowProps = {
  row: StagedRow
  payeeText: string
  categoryText: string
  matchPayee: string
  payeeOptions: ComboOption[]
  categoryOptions: ComboOption[]
  onChange: (change: RowPatch) => void
  onRule: () => void
}

function ReviewRow({
  row,
  payeeText,
  categoryText,
  matchPayee,
  payeeOptions,
  categoryOptions,
  onChange,
  onRule,
}: RowProps) {
  // Typed text lives here until a pick. Leaving a cell drops unpicked text, except that an
  // emptied field clears the value.
  const [payee, setPayee] = useState<string | null>(null)
  const [category, setCategory] = useState<string | null>(null)
  const label = `row ${row.row_index + 1}`
  const muted = row.disposition === 'skip'

  return (
    <tr
      className={`border-b border-slate-100 align-top dark:border-slate-800/70 ${muted ? 'text-slate-400' : ''}`}
      data-testid="review-row"
    >
      <td className="py-1 pr-2">
        <select
          aria-label={`Action for ${label}`}
          value={row.disposition}
          onChange={(event) => onChange({ disposition: event.target.value as Disposition })}
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:bg-slate-950"
        >
          <option value="import">Import</option>
          {row.match && <option value="match">Match</option>}
          <option value="skip">Skip</option>
        </select>
      </td>
      <td className="py-1 pr-2 whitespace-nowrap tabular-nums">{row.date}</td>
      <td className="py-1 pr-2">
        <div>{row.raw_description}</div>
        {row.raw_memo && <div className="text-xs text-slate-500">{row.raw_memo}</div>}
        <div className="flex flex-wrap gap-1">
          {row.is_duplicate && (
            <span className="rounded bg-amber-100 px-1 text-xs text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
              already imported
            </span>
          )}
          {row.applied_rule_id !== null && (
            <span className="rounded bg-sky-100 px-1 text-xs text-sky-800 dark:bg-sky-900/50 dark:text-sky-200">
              rule
            </span>
          )}
        </div>
      </td>
      <td
        className={`py-1 pr-2 text-right whitespace-nowrap tabular-nums ${row.amount_cents > 0 && !muted ? 'text-emerald-600' : ''}`}
      >
        {formatCents(row.amount_cents)}
      </td>
      {row.disposition === 'match' && row.match ? (
        <td colSpan={2} className="py-1 pr-2 text-sm" data-testid="match-note">
          Marks your entry of {row.match.date}
          {matchPayee && <> to {matchPayee}</>} as cleared. Its payee and category stay.
        </td>
      ) : (
        <>
          <td
            className="py-1 pr-2"
            onBlur={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
              if (payee !== null && payee.trim() === '' && payeeText)
                onChange({ payee_id: null, new_payee_name: null })
              setPayee(null)
            }}
          >
            <Combobox
              aria-label={`Payee for ${label}`}
              options={payeeOptions}
              allowCreate
              disabled={muted}
              text={payee ?? payeeText}
              onTextChange={setPayee}
              onPick={(option) => {
                setPayee(null)
                onChange(
                  option.key === CREATE_KEY
                    ? { new_payee_name: option.label, payee_id: null }
                    : { payee_id: Number(option.key), new_payee_name: null },
                )
              }}
              className={FIELD}
            />
            {row.new_payee_name && <div className="text-xs text-slate-500">new payee</div>}
          </td>
          <td
            className="py-1 pr-2"
            onBlur={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
              if (category !== null && category.trim() === '' && categoryText)
                onChange({ category_id: null })
              setCategory(null)
            }}
          >
            <Combobox
              aria-label={`Category for ${label}`}
              options={categoryOptions}
              disabled={muted}
              text={category ?? categoryText}
              onTextChange={setCategory}
              onPick={(option) => {
                setCategory(null)
                onChange({ category_id: Number(option.key) })
              }}
              className={FIELD}
            />
          </td>
        </>
      )}
      <td className="py-1 text-xs">
        {row.bill && row.disposition !== 'skip' && (
          <label className="flex items-center gap-1 whitespace-nowrap">
            <input
              type="checkbox"
              aria-label={`Mark ${row.bill.name} paid`}
              checked={row.link_bill}
              onChange={(event) => onChange({ link_bill: event.target.checked })}
            />
            Pays {row.bill.name} ({row.bill.due_date})
          </label>
        )}
        {row.disposition === 'import' && (
          <button
            type="button"
            onClick={onRule}
            className="mt-0.5 rounded px-1 text-sky-700 underline outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-sky-300"
          >
            Create rule from this
          </button>
        )}
      </td>
    </tr>
  )
}
