import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { KeyboardEvent } from 'react'

import { ApiRequestError } from '../../api/client'
import { queryKeys } from '../../api/keys'
import { deleteRule, EMPTY_RULE, fetchRules, moveRule, updateRule } from '../../api/rules'
import type { Rule } from '../../api/rules'
import { useToast } from '../../components/toastContext'
import { formatCents } from '../../lib/money'
import { useReferenceData } from '../ledger/useLedgerData'
import { MATCH_TYPE_LABEL } from '../rules/labels'
import { RuleForm } from '../rules/RuleForm'
import { useRuleSave } from '../rules/useRuleSave'

const BUTTON =
  'rounded px-2 py-0.5 text-xs text-slate-600 outline-none hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-30 dark:text-slate-300 dark:hover:bg-slate-800'

function errorText(error: unknown): string {
  return error instanceof ApiRequestError ? error.detail : 'That did not work.'
}

/** Where a moved item lands; mirrors app/domain/ordering.moved. */
function moved<T extends { id: number }>(items: T[], id: number, offset: number): T[] {
  const from = items.findIndex((item) => item.id === id)
  if (from < 0) return items
  const to = Math.max(0, Math.min(items.length - 1, from + offset))
  const copy = [...items]
  const [item] = copy.splice(from, 1)
  copy.splice(to, 0, item)
  return copy
}

/** Settings → Rules (SPEC §11): the first matching rule wins, so order matters. */
export function RulesSettingsPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const reference = useReferenceData()
  const rules = useQuery({ queryKey: queryKeys.rules, queryFn: ({ signal }) => fetchRules(signal) })
  const [editing, setEditing] = useState<number | 'new' | null>(null)

  const save = useRuleSave((rule) => {
    setEditing(null)
    toast(`Rule “${rule.name}” saved.`, 'success')
  })

  function optimistic(change: (items: Rule[]) => Rule[]) {
    const previous = queryClient.getQueryData<{ items: Rule[] }>(queryKeys.rules)
    if (previous) queryClient.setQueryData(queryKeys.rules, { items: change(previous.items) })
    return { previous }
  }
  const rollback = (error: unknown, _vars: unknown, context?: { previous?: { items: Rule[] } }) => {
    if (context?.previous) queryClient.setQueryData(queryKeys.rules, context.previous)
    toast(errorText(error))
  }

  const move = useMutation({
    mutationFn: ({ id, offset }: { id: number; offset: number }) => moveRule(id, offset),
    onMutate: async ({ id, offset }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.rules })
      return optimistic((items) => moved(items, id, offset))
    },
    onError: rollback,
    onSuccess: (result) => queryClient.setQueryData(queryKeys.rules, result),
  })
  const toggle = useMutation({
    mutationFn: (rule: Rule) => updateRule(rule.id, { is_active: !rule.is_active }),
    onMutate: async (rule) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.rules })
      return optimistic((items) =>
        items.map((item) => (item.id === rule.id ? { ...item, is_active: !rule.is_active } : item)),
      )
    },
    onError: rollback,
  })
  const remove = useMutation({
    mutationFn: (rule: Rule) => deleteRule(rule.id),
    onMutate: async (rule) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.rules })
      return optimistic((items) => items.filter((item) => item.id !== rule.id))
    },
    onError: rollback,
  })

  const payeeName = (id: number | null) => reference.payees.find((p) => p.id === id)?.name
  const accountName = (id: number | null) => reference.accounts.find((a) => a.id === id)?.name
  const items = rules.data?.items ?? []

  function focusRow(id: number) {
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`[data-rule-id="${id}"]`)?.focus(),
    )
  }

  function handleRowKey(event: KeyboardEvent<HTMLLIElement>, rule: Rule) {
    if (event.target !== event.currentTarget) return
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      move.mutate({ id: rule.id, offset: event.key === 'ArrowUp' ? -1 : 1 })
      focusRow(rule.id)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      setEditing(rule.id)
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const index = items.findIndex((item) => item.id === rule.id)
      const next = items[index + (event.key === 'ArrowUp' ? -1 : 1)]
      if (next) focusRow(next.id)
    }
  }

  function form(rule: Rule | null) {
    return (
      <RuleForm
        initial={rule ?? EMPTY_RULE}
        editing={rule !== null}
        accounts={reference.accounts}
        payees={reference.payees}
        categories={reference.categories}
        busy={save.isPending}
        onSave={(draft) => save.mutate({ id: rule?.id ?? null, draft })}
        onCancel={() => setEditing(null)}
      />
    )
  }

  if (rules.isPending || reference.loading)
    return <p className="text-sm text-slate-500">Loading…</p>

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Rules fill in the payee, category and memo of imported rows. They are checked top to
          bottom and <strong>the first match wins</strong>. Alt+↑/↓ moves the focused rule.
        </p>
        {editing === null && (
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="shrink-0 rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:bg-slate-100 dark:text-slate-900"
          >
            Add rule
          </button>
        )}
      </div>

      {editing === 'new' && <div className="mt-4">{form(null)}</div>}

      {items.length === 0 && editing !== 'new' && (
        <p className="mt-6 text-sm text-slate-500">
          No rules yet. Add one here, or use “Create rule from this” while reviewing an import.
        </p>
      )}

      <ol className="mt-4 flex flex-col gap-1" aria-label="Rules">
        {items.map((rule, index) =>
          editing === rule.id ? (
            <li key={rule.id}>{form(rule)}</li>
          ) : (
            <li
              key={rule.id}
              tabIndex={0}
              data-rule-id={rule.id}
              data-testid="rule-row"
              onKeyDown={(event) => handleRowKey(event, rule)}
              className={`flex items-center gap-3 rounded border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-800 dark:bg-slate-900 ${rule.is_active ? '' : 'opacity-50'}`}
            >
              <span className="w-5 text-right text-xs text-slate-400 tabular-nums">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate">
                  <span className="text-slate-500">
                    {rule.match_field === 'memo' ? 'Memo' : 'Description'}{' '}
                    {MATCH_TYPE_LABEL[rule.match_type]}{' '}
                  </span>
                  <span className="font-medium">“{rule.match_value}”</span>
                  {(rule.amount_min_cents !== null || rule.amount_max_cents !== null) && (
                    <span className="text-slate-500">
                      {' '}
                      · amount{' '}
                      {rule.amount_min_cents !== null ? formatCents(rule.amount_min_cents) : '…'}
                      {' to '}
                      {rule.amount_max_cents !== null ? formatCents(rule.amount_max_cents) : '…'}
                    </span>
                  )}
                  {rule.account_id !== null && (
                    <span className="text-slate-500"> · in {accountName(rule.account_id)}</span>
                  )}
                </div>
                <div className="truncate text-xs text-slate-500">
                  →{' '}
                  {[
                    rule.set_payee_id !== null && `payee ${payeeName(rule.set_payee_id) ?? '?'}`,
                    rule.set_category_id !== null &&
                      `category ${reference.categoryNames.get(rule.set_category_id) ?? '?'}`,
                    rule.set_memo && `memo “${rule.set_memo}”`,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </div>
              </div>
              <button
                type="button"
                className={BUTTON}
                disabled={index === 0}
                aria-label={`Move rule ${index + 1} up`}
                onClick={() => move.mutate({ id: rule.id, offset: -1 })}
              >
                ↑
              </button>
              <button
                type="button"
                className={BUTTON}
                disabled={index === items.length - 1}
                aria-label={`Move rule ${index + 1} down`}
                onClick={() => move.mutate({ id: rule.id, offset: 1 })}
              >
                ↓
              </button>
              <button type="button" className={BUTTON} onClick={() => toggle.mutate(rule)}>
                {rule.is_active ? 'Turn off' : 'Turn on'}
              </button>
              <button type="button" className={BUTTON} onClick={() => setEditing(rule.id)}>
                Edit
              </button>
              <button
                type="button"
                className={`${BUTTON} text-rose-600 dark:text-rose-400`}
                onClick={() => {
                  if (window.confirm(`Delete the rule “${rule.name}”?`)) remove.mutate(rule)
                }}
              >
                Delete
              </button>
            </li>
          ),
        )}
      </ol>
    </div>
  )
}
