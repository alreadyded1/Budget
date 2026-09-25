import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'

import { ApiRequestError } from '../../api/client'
import { queryKeys } from '../../api/keys'
import { createPayee, fetchPayees, mergePayees, updatePayee } from '../../api/payees'
import type { Payee } from '../../api/payees'
import { useToast } from '../../components/toastContext'
import { formatCents } from '../../lib/money'

const inputClass =
  'rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:bg-slate-950'

type MergeOffer = { source: Payee; targetName: string }

export function PayeesPage() {
  const queryClient = useQueryClient()
  const toast = useToast()

  const [search, setSearch] = useState('')
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draftName, setDraftName] = useState('')
  const [mergeOffer, setMergeOffer] = useState<MergeOffer | null>(null)

  const { data, isPending } = useQuery({
    queryKey: [...queryKeys.payees, search],
    queryFn: ({ signal }) => fetchPayees(search, signal),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.payees })
  const onError = (error: unknown) =>
    toast(error instanceof ApiRequestError ? error.detail : 'That did not work.')

  const add = useMutation({
    mutationFn: createPayee,
    onSuccess: () => {
      setNewName('')
      invalidate()
    },
    onError,
  })

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => updatePayee(id, { name }),
    onSuccess: () => {
      setEditingId(null)
      invalidate()
    },
    onError: (error, variables) => {
      // A clash is the merge offer, not a failure (SPEC §5).
      if (error instanceof ApiRequestError && error.code === 'payee_name_taken') {
        const source = data?.items.find((row) => row.id === variables.id)
        if (source) {
          setMergeOffer({ source, targetName: variables.name })
          return
        }
      }
      onError(error)
    },
  })

  const merge = useMutation({
    mutationFn: ({ targetId, sourceId }: { targetId: number; sourceId: number }) =>
      mergePayees(targetId, sourceId),
    onSuccess: (result) => {
      const moved = Object.values(result.moved).reduce((sum, count) => sum + count, 0)
      setMergeOffer(null)
      setEditingId(null)
      invalidate()
      toast(
        moved > 0
          ? `Merged into ${result.payee.name}, moving ${moved} entries.`
          : `Merged into ${result.payee.name}.`,
        'success',
      )
    },
    onError,
  })

  const toggleHidden = useMutation({
    mutationFn: ({ id, hidden }: { id: number; hidden: boolean }) =>
      updatePayee(id, { is_hidden: hidden }),
    onSuccess: () => invalidate(),
    onError,
  })

  function startEditing(payee: Payee) {
    setEditingId(payee.id)
    setDraftName(payee.name)
  }

  function handleRenameKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      setEditingId(null)
    }
  }

  function confirmMerge() {
    if (!mergeOffer || !data) return
    const target = data.items.find(
      (row) => row.name.toLowerCase() === mergeOffer.targetName.toLowerCase(),
    )
    if (!target) {
      toast('Could not find the payee to merge into. Reload and try again.')
      setMergeOffer(null)
      return
    }
    merge.mutate({ targetId: target.id, sourceId: mergeOffer.source.id })
  }

  return (
    <section>
      <h1 className="text-xl font-semibold tracking-tight">Payees</h1>

      <input
        type="search"
        aria-label="Search payees"
        placeholder="Search payees…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className={`${inputClass} mt-4 w-64`}
      />

      {mergeOffer ? (
        <div className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
          <p>
            <strong>{mergeOffer.targetName}</strong> already exists. Merge{' '}
            <strong>{mergeOffer.source.name}</strong> into it? Its transactions, bills and rules
            move across, and {mergeOffer.source.name} is removed.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={confirmMerge}
              disabled={merge.isPending}
              className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
            >
              Merge them
            </button>
            <button
              type="button"
              onClick={() => setMergeOffer(null)}
              className="rounded px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300"
            >
              Keep both
            </button>
          </div>
        </div>
      ) : null}

      {isPending || !data ? (
        <p className="mt-4 text-sm text-slate-500">Loading…</p>
      ) : data.items.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">
          {search ? 'No payees match that search.' : 'No payees yet. They build up as you spend.'}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-200 rounded border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {data.items.map((payee) => (
            <li key={payee.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                {editingId === payee.id ? (
                  <form
                    onSubmit={(event: FormEvent<HTMLFormElement>) => {
                      event.preventDefault()
                      rename.mutate({ id: payee.id, name: draftName })
                    }}
                  >
                    <input
                      autoFocus
                      aria-label={`Rename ${payee.name}`}
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                      onKeyDown={handleRenameKey}
                      onBlur={() => setEditingId(null)}
                      className={`${inputClass} w-full`}
                    />
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => startEditing(payee)}
                    className="truncate rounded text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-sky-500"
                  >
                    {payee.name}
                    {payee.is_hidden ? (
                      <span className="ml-2 text-xs text-slate-400">hidden</span>
                    ) : null}
                  </button>
                )}
              </div>

              <span className="shrink-0 text-xs tabular-nums text-slate-500">
                {payee.transaction_count} uses
              </span>
              <span className="shrink-0 text-xs tabular-nums text-slate-500">
                {formatCents(payee.total_spent_cents)}
              </span>
              <span className="shrink-0 text-xs text-slate-400">{payee.last_used ?? 'never'}</span>
              <button
                type="button"
                onClick={() => toggleHidden.mutate({ id: payee.id, hidden: !payee.is_hidden })}
                className="shrink-0 rounded px-2 py-1 text-xs text-slate-600 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {payee.is_hidden ? 'Unhide' : 'Hide'}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-xs text-slate-500">
        Click a name to rename it. Enter saves, Esc cancels. Usage counts fill in once transactions
        exist.
      </p>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (newName.trim()) add.mutate({ name: newName.trim() })
        }}
        className="mt-6"
      >
        <h2 className="text-sm font-semibold">Add a payee</h2>
        <input
          aria-label="New payee name"
          placeholder="Payee name"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          className={`${inputClass} mt-2 w-64`}
        />
      </form>
    </section>
  )
}
