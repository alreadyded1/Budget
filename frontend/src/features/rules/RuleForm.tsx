import { useMutation } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'

import type { Account } from '../../api/accounts'
import { ApiRequestError } from '../../api/client'
import type { Payee } from '../../api/payees'
import { testRule } from '../../api/rules'
import type { MatchType, RuleInput, RuleTestResult } from '../../api/rules'
import { AmountInput } from '../../components/AmountInput'
import { CREATE_KEY, Combobox } from '../../components/Combobox'
import type { ComboOption } from '../../components/Combobox'
import { evaluateAmount } from '../../lib/amountExpr'
import { formatCents } from '../../lib/money'
import { MATCH_TYPE_LABEL } from './labels'
import type { CategoryOption } from '../ledger/draft'
import { centsToInput } from '../ledger/draft'

const LABEL = 'block text-xs font-medium text-slate-500'
const FIELD =
  'mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:bg-slate-950'

/** What the form hands back: the rule, plus a payee name to create first if one was typed. */
export type RuleDraft = { rule: RuleInput; newPayeeName: string | null }

type Props = {
  initial: RuleInput
  /** Shown in the payee field when the rule is to create a payee, e.g. from an import row. */
  initialNewPayee?: string | null
  editing: boolean
  accounts: Account[]
  payees: Payee[]
  categories: CategoryOption[]
  busy: boolean
  onSave: (draft: RuleDraft) => void
  onCancel: () => void
}

function amountText(cents: number | null): string {
  if (cents === null) return ''
  return `${cents < 0 ? '-' : ''}${centsToInput(cents)}`
}

/** Add or edit a rule (SPEC §11). Enter saves from any field; Esc cancels. */
export function RuleForm({
  initial,
  initialNewPayee = null,
  editing,
  accounts,
  payees,
  categories,
  busy,
  onSave,
  onCancel,
}: Props) {
  const [rule, setRule] = useState<RuleInput>(initial)
  const set = (patch: Partial<RuleInput>) => setRule((current) => ({ ...current, ...patch }))
  const [payeeText, setPayeeText] = useState(
    initialNewPayee ?? payees.find((payee) => payee.id === initial.set_payee_id)?.name ?? '',
  )
  const [newPayee, setNewPayee] = useState<string | null>(initialNewPayee)
  const [categoryText, setCategoryText] = useState(
    categories.find((category) => category.id === initial.set_category_id)?.name ?? '',
  )
  const [minText, setMinText] = useState(amountText(initial.amount_min_cents))
  const [maxText, setMaxText] = useState(amountText(initial.amount_max_cents))
  const [error, setError] = useState<string | null>(null)

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

  const test = useMutation({ mutationFn: testRule })

  /** The rule as it stands, or an error message for the first bad field. */
  function current(): RuleInput | string {
    const min = minText.trim() ? evaluateAmount(minText) : null
    const max = maxText.trim() ? evaluateAmount(maxText) : null
    if (minText.trim() && min === null) return 'The minimum amount is not a number.'
    if (maxText.trim() && max === null) return 'The maximum amount is not a number.'
    if (!rule.match_value.trim()) return 'Type the text to match.'
    if (payeeText.trim() && rule.set_payee_id === null && newPayee === null)
      return 'Pick a payee from the list, or clear the field.'
    if (categoryText.trim() && rule.set_category_id === null)
      return 'Pick a category from the list, or clear the field.'
    return {
      ...rule,
      match_value: rule.match_value.trim(),
      set_memo: rule.set_memo?.trim() ? rule.set_memo.trim() : null,
      amount_min_cents: min,
      amount_max_cents: max,
    }
  }

  function save() {
    const built = current()
    if (typeof built === 'string') {
      setError(built)
      return
    }
    if (
      built.set_payee_id === null &&
      newPayee === null &&
      built.set_category_id === null &&
      !built.set_memo
    ) {
      setError('A rule needs something to do: a payee, a category or a memo.')
      return
    }
    setError(null)
    onSave({ rule: built, newPayeeName: built.set_payee_id === null ? newPayee : null })
  }

  function runTest() {
    const built = current()
    if (typeof built === 'string') {
      setError(built)
      return
    }
    setError(null)
    test.mutate(built)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.isDefaultPrevented()) return
    const target = event.target as HTMLElement
    if (event.key === 'Enter' && target.tagName !== 'BUTTON') {
      event.preventDefault()
      if (!busy) save()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    }
  }

  const result: RuleTestResult | undefined = test.data
  const testError =
    test.error instanceof ApiRequestError
      ? test.error.detail
      : test.error
        ? 'The test failed.'
        : null

  return (
    <div
      role="group"
      aria-label={editing ? 'Edit rule' : 'New rule'}
      className="rounded border border-sky-200 bg-sky-50/60 p-4 dark:border-sky-900 dark:bg-sky-950/30"
      onKeyDown={handleKeyDown}
      data-testid="rule-form"
    >
      <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">When</p>
      <div className="mt-1 grid gap-3 sm:grid-cols-[8rem_9rem_1fr]">
        <label>
          <span className={LABEL}>Field</span>
          <select
            aria-label="Match field"
            value={rule.match_field}
            onChange={(event) =>
              set({ match_field: event.target.value as RuleInput['match_field'] })
            }
            className={FIELD}
          >
            <option value="description">Description</option>
            <option value="memo">Memo</option>
          </select>
        </label>
        <label>
          <span className={LABEL}>How</span>
          <select
            aria-label="Match type"
            value={rule.match_type}
            onChange={(event) => set({ match_type: event.target.value as MatchType })}
            className={FIELD}
          >
            {(Object.keys(MATCH_TYPE_LABEL) as MatchType[]).map((type) => (
              <option key={type} value={type}>
                {MATCH_TYPE_LABEL[type]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={LABEL}>Text (any case)</span>
          <input
            aria-label="Match text"
            autoFocus
            value={rule.match_value}
            onChange={(event) => set({ match_value: event.target.value })}
            className={FIELD}
          />
        </label>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label>
          <span className={LABEL}>Amount from (optional)</span>
          <AmountInput
            aria-label="Amount from"
            value={minText}
            onChange={setMinText}
            className={FIELD}
          />
        </label>
        <label>
          <span className={LABEL}>Amount to (optional)</span>
          <AmountInput
            aria-label="Amount to"
            value={maxText}
            onChange={setMaxText}
            className={FIELD}
          />
        </label>
        <label>
          <span className={LABEL}>Account</span>
          <select
            aria-label="Rule account"
            value={rule.account_id ?? ''}
            onChange={(event) =>
              set({ account_id: event.target.value ? Number(event.target.value) : null })
            }
            className={FIELD}
          >
            <option value="">Any account</option>
            {accounts
              .filter((account) => !account.is_closed)
              .map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Spending is negative: −50 to −10 means $10–$50 spent.
      </p>

      <p className="mt-4 text-xs font-semibold tracking-wide text-slate-500 uppercase">Then set</p>
      <div className="mt-1 grid gap-3 sm:grid-cols-3">
        <div>
          <span className={LABEL}>Payee</span>
          <Combobox
            aria-label="Rule payee"
            options={payeeOptions}
            allowCreate
            text={payeeText}
            onTextChange={(text) => {
              setPayeeText(text)
              setNewPayee(null)
              set({ set_payee_id: null })
            }}
            onPick={(option) => {
              setPayeeText(option.label)
              if (option.key === CREATE_KEY) {
                setNewPayee(option.label)
                set({ set_payee_id: null })
              } else {
                setNewPayee(null)
                set({ set_payee_id: Number(option.key) })
              }
            }}
            className={FIELD}
          />
        </div>
        <div>
          <span className={LABEL}>Category</span>
          <Combobox
            aria-label="Rule category"
            options={categoryOptions}
            text={categoryText}
            onTextChange={(text) => {
              setCategoryText(text)
              set({ set_category_id: null })
            }}
            onPick={(option) => {
              setCategoryText(option.label)
              set({ set_category_id: Number(option.key) })
            }}
            className={FIELD}
          />
        </div>
        <label>
          <span className={LABEL}>Memo</span>
          <input
            aria-label="Rule memo"
            value={rule.set_memo ?? ''}
            onChange={(event) => set({ set_memo: event.target.value })}
            className={FIELD}
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-rose-600">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {editing ? 'Save rule' : 'Add rule'}
        </button>
        <button
          type="button"
          onClick={runTest}
          disabled={test.isPending}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          Test against past imports
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-3 py-1.5 text-sm text-slate-600 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
      </div>

      {testError && <p className="mt-3 text-sm text-rose-600">{testError}</p>}
      {result && (
        <div className="mt-3 text-sm" data-testid="rule-test-result">
          <p className="text-slate-600 dark:text-slate-300">
            Matches {result.matches.length} of the last {result.checked} imported rows.
          </p>
          {result.matches.length > 0 && (
            <ul className="mt-1 max-h-48 overflow-auto rounded border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              {result.matches.slice(0, 50).map((row, index) => (
                <li
                  key={index}
                  className="flex justify-between gap-3 border-b border-slate-100 px-2 py-1 last:border-0 dark:border-slate-800"
                >
                  <span className="text-slate-500 tabular-nums">{row.date}</span>
                  <span className="flex-1 truncate">{row.raw_description}</span>
                  <span className="tabular-nums">{formatCents(row.amount_cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
