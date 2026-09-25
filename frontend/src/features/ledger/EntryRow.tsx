import { useCallback, useImperativeHandle, useMemo, useState } from 'react'
import type { Dispatch, KeyboardEvent, Ref, SetStateAction } from 'react'
import { flushSync } from 'react-dom'

import type { Account } from '../../api/accounts'
import { AmountInput } from '../../components/AmountInput'
import { Combobox, CREATE_KEY } from '../../components/Combobox'
import type { ComboOption } from '../../components/Combobox'
import { DateInput } from '../../components/DateInput'
import { formatCents } from '../../lib/money'
import { INPUT_CLASS, gridTemplate } from './columns'
import { SPLIT_LABEL, centsToInput, newSplit, splitRemaining, transferLabel } from './draft'
import type { Draft, FieldName, Lookups, SplitDraft } from './draft'

export type EntryRowHandle = { focus: (field: FieldName) => void }

type Props = {
  mode: 'new' | 'edit'
  draft: Draft
  setDraft: Dispatch<SetStateAction<Draft>>
  lookups: Lookups
  /** The account a single-account ledger is showing; null shows the Account field. */
  fixedAccount: Account | null
  prefillLastAmount: boolean
  onSave: () => void
  onCancel: () => void
  handleRef?: Ref<EntryRowHandle>
  busy?: boolean
}

const SPLIT_KEY = '__split__'

/** The ledger's entry row, pinned on top for new entries and reused for inline edits.
 *
 * Tab order is the DOM order: (Account) → Date → Payee → Category → Memo → Outflow →
 * Inflow, then any split lines. Enter saves from anywhere unless a dropdown takes it;
 * Esc closes a dropdown first and clears (or cancels) the row second (SPEC §7).
 */
export function EntryRow({
  mode,
  draft,
  setDraft,
  lookups,
  fixedAccount,
  prefillLastAmount,
  onSave,
  onCancel,
  handleRef,
  busy = false,
}: Props) {
  // A Map held in state (not a ref) so the ref callbacks below can be built during render.
  const [fields] = useState(() => new Map<FieldName, HTMLInputElement | null>())

  const refFor = (name: FieldName) => (element: HTMLInputElement | null) => {
    fields.set(name, element)
  }

  /** Focuses a field now if it exists, otherwise once React has rendered it (a split
   * line that was just added). Focusing at once matters: the next keystroke may already
   * be on its way, and it must land in the new field. */
  const focusSoon = useCallback(
    (field: FieldName) => {
      const focus = () => {
        const element = fields.get(field)
        if (!element?.isConnected) return false
        element.focus()
        element.select()
        return true
      }
      if (!focus()) window.setTimeout(focus, 0)
    },
    [fields],
  )

  useImperativeHandle(handleRef, () => ({ focus: focusSoon }), [focusSoon])

  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }))

  const hereId = fixedAccount?.id ?? draft.accountId
  const openAccounts = useMemo(
    () => lookups.accounts.filter((account) => !account.is_closed),
    [lookups.accounts],
  )

  const accountOptions = useMemo<ComboOption[]>(
    () => openAccounts.map((account) => ({ key: String(account.id), label: account.name })),
    [openAccounts],
  )

  const payeeOptions = useMemo<ComboOption[]>(() => {
    const payees = lookups.payees
      .filter((payee) => !payee.is_hidden)
      .map((payee) => ({ key: `p:${payee.id}`, label: payee.name }))
    const transfers = openAccounts
      .filter((account) => account.id !== hereId)
      .map((account) => ({ key: `t:${account.id}`, label: transferLabel(account) }))
    return [...payees, ...transfers]
  }, [lookups.payees, openAccounts, hereId])

  const categoryOptions = useMemo<ComboOption[]>(
    () =>
      lookups.categories.map((category) => ({
        key: String(category.id),
        label: category.name,
        group: category.groupName,
      })),
    [lookups.categories],
  )
  const splitPinned = useMemo<ComboOption[]>(() => [{ key: SPLIT_KEY, label: SPLIT_LABEL }], [])

  function pickPayee(option: ComboOption) {
    if (option.key === CREATE_KEY) {
      update({ payeeText: option.label, payeeId: null, transferAccountId: null })
      return
    }
    const [kind, rawId] = option.key.split(':')
    const id = Number(rawId)
    if (kind === 't') {
      update({ payeeText: option.label, payeeId: null, transferAccountId: id })
      return
    }
    const payee = lookups.payees.find((row) => row.id === id)
    setDraft((current) => {
      const next: Draft = {
        ...current,
        payeeText: option.label,
        payeeId: id,
        transferAccountId: null,
      }
      if (payee === undefined) return next
      // SPEC §7: the pinned default category, otherwise the last one used.
      const categoryId = payee.default_category_id ?? payee.last_category_id
      const category = lookups.categories.find((row) => row.id === categoryId)
      if (category && current.splits === null && !current.categoryText.trim()) {
        next.categoryId = category.id
        next.categoryText = category.name
      }
      if (
        prefillLastAmount &&
        payee.last_amount_cents &&
        !current.outflow.trim() &&
        !current.inflow.trim()
      ) {
        const text = centsToInput(payee.last_amount_cents)
        if (payee.last_amount_cents < 0) next.outflow = text
        else next.inflow = text
      }
      return next
    })
  }

  function pickCategory(option: ComboOption) {
    if (option.key === SPLIT_KEY) {
      setDraft((current) => ({
        ...current,
        categoryText: SPLIT_LABEL,
        categoryId: null,
        splits: current.splits ?? [
          {
            ...newSplit(),
            categoryId: current.categoryId,
            categoryText: current.categoryId !== null ? current.categoryText : '',
          },
        ],
      }))
      return
    }
    update({ categoryText: option.label, categoryId: Number(option.key), splits: null })
  }

  function setOutflow(value: string) {
    if (value.startsWith('+')) {
      // A leading + in Outflow means it was money in.
      update({ outflow: '', inflow: value.slice(1) })
      focusSoon('inflow')
      return
    }
    setDraft((current) => ({
      ...current,
      outflow: value,
      inflow: value.trim() ? '' : current.inflow,
    }))
  }

  function setInflow(value: string) {
    setDraft((current) => ({
      ...current,
      inflow: value,
      outflow: value.trim() ? '' : current.outflow,
    }))
  }

  function updateSplit(index: number, patch: Partial<SplitDraft>) {
    setDraft((current) => ({
      ...current,
      splits: (current.splits ?? []).map((split, at) =>
        at === index ? { ...split, ...patch } : split,
      ),
    }))
  }

  function removeSplit(index: number) {
    setDraft((current) => {
      const splits = (current.splits ?? []).filter((_, at) => at !== index)
      return splits.length === 0
        ? { ...current, splits: null, categoryText: '', categoryId: null }
        : { ...current, splits }
    })
  }

  const remaining = splitRemaining(draft)

  function handleSplitAmountKey(event: KeyboardEvent<HTMLInputElement>, index: number) {
    const splits = draft.splits ?? []
    const isLast = index === splits.length - 1
    if (event.key === 'Tab' && !event.shiftKey && isLast && remaining !== null && remaining > 0) {
      // Tabbing out of the last line with money left over starts the next line with it.
      event.preventDefault()
      // Render the new line now, so focus moves before the next keystroke arrives; a
      // deferred focus let fast typing land in the old amount field.
      flushSync(() =>
        setDraft((current) => ({
          ...current,
          splits: [...(current.splits ?? []), newSplit(centsToInput(remaining))],
        })),
      )
      focusSoon(`split-${splits.length}-category`)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.isDefaultPrevented()) return
    if (event.key === 'Enter') {
      event.preventDefault()
      if (!busy) onSave()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    }
  }

  const outgoing = !draft.inflow.trim()

  return (
    <div
      role="group"
      aria-label={mode === 'new' ? 'New transaction' : 'Edit transaction'}
      className={[
        'border-b border-slate-200 px-2 py-1.5 dark:border-slate-800',
        mode === 'new' ? 'bg-sky-50/70 dark:bg-sky-950/30' : 'bg-amber-50/70 dark:bg-amber-950/20',
      ].join(' ')}
      onKeyDown={handleKeyDown}
      data-testid={mode === 'new' ? 'entry-row' : 'edit-row'}
    >
      <div
        className="grid items-center gap-1.5"
        style={{ gridTemplateColumns: gridTemplate(fixedAccount === null) }}
      >
        {fixedAccount === null && (
          <Combobox
            aria-label="Account"
            inputRef={refFor('account')}
            options={accountOptions}
            text={draft.accountText}
            onTextChange={(text) => update({ accountText: text, accountId: null })}
            onPick={(option) =>
              update({ accountText: option.label, accountId: Number(option.key) })
            }
            className={INPUT_CLASS}
            placeholder="Account"
          />
        )}
        <DateInput
          aria-label="Date"
          inputRef={refFor('date')}
          value={draft.date}
          today={lookups.today}
          onChange={(date) => update({ date })}
          className={INPUT_CLASS}
        />
        <Combobox
          aria-label="Payee"
          inputRef={refFor('payee')}
          options={payeeOptions}
          allowCreate
          text={draft.payeeText}
          onTextChange={(text) =>
            update({ payeeText: text, payeeId: null, transferAccountId: null })
          }
          onPick={pickPayee}
          className={INPUT_CLASS}
          placeholder="Payee"
        />
        <Combobox
          aria-label="Category"
          inputRef={refFor('category')}
          options={categoryOptions}
          pinned={splitPinned}
          text={draft.categoryText}
          onTextChange={(text) =>
            // Typing over "Split…" turns the row back into a single category.
            update({ categoryText: text, categoryId: null, splits: null })
          }
          onPick={pickCategory}
          className={INPUT_CLASS}
          placeholder={draft.transferAccountId !== null ? 'Transfer' : 'Category'}
        />
        <input
          aria-label="Memo"
          ref={refFor('memo')}
          type="text"
          autoComplete="off"
          value={draft.memo}
          onChange={(event) => update({ memo: event.target.value })}
          onFocus={(event) => event.currentTarget.select()}
          className={INPUT_CLASS}
          placeholder="Memo"
        />
        <AmountInput
          aria-label="Outflow"
          inputRef={refFor('outflow')}
          value={draft.outflow}
          onChange={setOutflow}
          className={INPUT_CLASS}
          placeholder="Outflow"
        />
        <AmountInput
          aria-label="Inflow"
          inputRef={refFor('inflow')}
          value={draft.inflow}
          onChange={setInflow}
          className={INPUT_CLASS}
          placeholder="Inflow"
        />
        <div />
        <div className="flex justify-end gap-1">
          <button
            type="button"
            tabIndex={-1}
            disabled={busy}
            onClick={onSave}
            className="rounded bg-sky-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {mode === 'new' ? 'Save' : 'Done'}
          </button>
          {mode === 'edit' && (
            <button
              type="button"
              tabIndex={-1}
              onClick={onCancel}
              className="rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {draft.splits !== null && (
        <div className="mt-1.5 space-y-1" aria-label="Split lines" role="group">
          {draft.splits.map((split, index) => (
            <div
              key={split.key}
              className="grid items-center gap-1.5"
              style={{ gridTemplateColumns: gridTemplate(fixedAccount === null) }}
            >
              {fixedAccount === null && <div />}
              <div />
              <div className="text-right text-xs text-slate-400">Split {index + 1}</div>
              <Combobox
                aria-label={`Split ${index + 1} category`}
                inputRef={refFor(`split-${index}-category`)}
                options={categoryOptions}
                text={split.categoryText}
                onTextChange={(text) =>
                  updateSplit(index, { categoryText: text, categoryId: null })
                }
                onPick={(option) =>
                  updateSplit(index, { categoryText: option.label, categoryId: Number(option.key) })
                }
                className={INPUT_CLASS}
                placeholder="Category"
              />
              <input
                aria-label={`Split ${index + 1} memo`}
                type="text"
                autoComplete="off"
                value={split.memo}
                onChange={(event) => updateSplit(index, { memo: event.target.value })}
                className={INPUT_CLASS}
                placeholder="Memo"
              />
              {!outgoing && <div />}
              <AmountInput
                aria-label={`Split ${index + 1} amount`}
                inputRef={refFor(`split-${index}-amount`)}
                value={split.amount}
                onChange={(amount) => updateSplit(index, { amount })}
                onKeyDown={(event) => handleSplitAmountKey(event, index)}
                className={INPUT_CLASS}
                placeholder="Amount"
              />
              {outgoing && <div />}
              <button
                type="button"
                tabIndex={-1}
                aria-label={`Remove split ${index + 1}`}
                onClick={() => removeSplit(index)}
                className="text-xs text-slate-400 hover:text-rose-600"
              >
                ✕
              </button>
            </div>
          ))}
          <div
            className="text-right text-xs tabular-nums"
            aria-live="polite"
            data-testid="split-remaining"
          >
            {remaining === null ? (
              <span className="text-rose-600">A split amount is not a number</span>
            ) : remaining === 0 ? (
              <span className="text-emerald-600">Splits add up</span>
            ) : (
              <span className={remaining < 0 ? 'text-rose-600' : 'text-amber-600'}>
                {remaining < 0 ? 'Over by ' : 'Remaining '}
                {formatCents(Math.abs(remaining))}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
