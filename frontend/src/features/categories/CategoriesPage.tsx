import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'

import { ApiRequestError } from '../../api/client'
import {
  createCategory,
  createGroup,
  fetchGroups,
  moveCategory,
  moveGroup,
  seedStarterCategories,
  updateCategory,
} from '../../api/categories'
import type { CategoryGroup } from '../../api/categories'
import { queryKeys } from '../../api/keys'
import { useToast } from '../../components/toastContext'
import { formatCents } from '../../lib/money'

const inputClass =
  'rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:bg-slate-950'

export function CategoriesPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const { data, isPending } = useQuery({
    queryKey: queryKeys.categoryGroups,
    queryFn: ({ signal }) => fetchGroups(signal),
  })

  const [groupName, setGroupName] = useState('')
  const [newCategory, setNewCategory] = useState<Record<number, string>>({})

  const replaceGroups = (result: { items: CategoryGroup[] }) =>
    queryClient.setQueryData(queryKeys.categoryGroups, result)
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.categoryGroups })
  const onError = (error: unknown) =>
    toast(error instanceof ApiRequestError ? error.detail : 'That did not work.')

  const seed = useMutation({
    mutationFn: seedStarterCategories,
    onSuccess: (result) => {
      replaceGroups(result)
      toast('Starter categories added. Edit them freely.', 'success')
    },
    onError,
  })

  const addGroup = useMutation({
    mutationFn: () => createGroup({ name: groupName, kind: 'expense' }),
    onSuccess: () => {
      setGroupName('')
      invalidate()
    },
    onError,
  })

  const addCategory = useMutation({
    mutationFn: ({ groupId, name }: { groupId: number; name: string }) =>
      createCategory({ group_id: groupId, name }),
    onSuccess: (_category, { groupId }) => {
      setNewCategory((current) => ({ ...current, [groupId]: '' }))
      invalidate()
    },
    onError,
  })

  const move = useMutation({
    mutationFn: ({ id, offset }: { id: number; offset: number }) => moveCategory(id, offset),
    onSuccess: replaceGroups,
    onError,
  })

  const shiftGroup = useMutation({
    mutationFn: ({ id, offset }: { id: number; offset: number }) => moveGroup(id, offset),
    onSuccess: replaceGroups,
    onError,
  })

  const toggleHidden = useMutation({
    mutationFn: ({ id, hidden }: { id: number; hidden: boolean }) =>
      updateCategory(id, { is_hidden: hidden }),
    onSuccess: () => invalidate(),
    onError,
  })

  const toggleSinkingFund = useMutation({
    mutationFn: ({ id, value }: { id: number; value: boolean }) =>
      updateCategory(id, { is_sinking_fund: value }),
    onSuccess: () => invalidate(),
    onError,
  })

  if (isPending || !data) return <p className="text-sm text-slate-500">Loading…</p>

  /** Alt+Up / Alt+Down reorder without touching the mouse (SPEC §4). */
  function handleCategoryKey(event: KeyboardEvent<HTMLLIElement>, id: number) {
    if (!event.altKey) return
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      move.mutate({ id, offset: -1 })
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      move.mutate({ id, offset: 1 })
    }
  }

  function handleAddCategory(event: FormEvent<HTMLFormElement>, groupId: number) {
    event.preventDefault()
    const name = (newCategory[groupId] ?? '').trim()
    if (name) addCategory.mutate({ groupId, name })
  }

  return (
    <section>
      <h1 className="text-xl font-semibold tracking-tight">Categories</h1>

      {data.items.length === 0 ? (
        <div className="mt-4 rounded border border-slate-200 p-4 dark:border-slate-800">
          <p className="text-sm">
            No categories yet. Start from a standard household set and change whatever does not fit.
          </p>
          <button
            type="button"
            onClick={() => seed.mutate()}
            disabled={seed.isPending}
            className="mt-3 rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
          >
            Add the starter categories
          </button>
        </div>
      ) : (
        <>
          <p className="mt-2 text-xs text-slate-500">
            Focus a category and press Alt+↑ or Alt+↓ to reorder it.
          </p>
          <div className="mt-4 space-y-6">
            {data.items.map((group) => (
              <div key={group.id}>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">{group.name}</h2>
                  <span className="text-xs text-slate-400">{group.kind}</span>
                  <button
                    type="button"
                    aria-label={`Move ${group.name} up`}
                    onClick={() => shiftGroup.mutate({ id: group.id, offset: -1 })}
                    className="rounded px-1 text-xs text-slate-400 outline-none hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-sky-500 dark:hover:text-slate-100"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${group.name} down`}
                    onClick={() => shiftGroup.mutate({ id: group.id, offset: 1 })}
                    className="rounded px-1 text-xs text-slate-400 outline-none hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-sky-500 dark:hover:text-slate-100"
                  >
                    ↓
                  </button>
                </div>

                <ul className="mt-2 divide-y divide-slate-100 rounded border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                  {group.categories.map((category) => (
                    <li
                      key={category.id}
                      tabIndex={0}
                      onKeyDown={(event) => handleCategoryKey(event, category.id)}
                      className="flex items-center gap-3 px-3 py-1.5 text-sm outline-none focus-visible:bg-sky-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 dark:focus-visible:bg-sky-950"
                    >
                      <span className={category.is_hidden ? 'flex-1 text-slate-400' : 'flex-1'}>
                        {category.name}
                        {category.is_sinking_fund ? (
                          <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
                            sinking fund
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-slate-500">
                        {formatCents(category.default_planned_cents)} planned
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          toggleSinkingFund.mutate({
                            id: category.id,
                            value: !category.is_sinking_fund,
                          })
                        }
                        className="shrink-0 rounded px-2 py-1 text-xs text-slate-500 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 dark:hover:bg-slate-800"
                      >
                        {category.is_sinking_fund ? 'Not a fund' : 'Make a fund'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          toggleHidden.mutate({ id: category.id, hidden: !category.is_hidden })
                        }
                        className="shrink-0 rounded px-2 py-1 text-xs text-slate-500 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 dark:hover:bg-slate-800"
                      >
                        {category.is_hidden ? 'Unhide' : 'Hide'}
                      </button>
                    </li>
                  ))}
                </ul>

                <form onSubmit={(event) => handleAddCategory(event, group.id)} className="mt-2">
                  <input
                    aria-label={`New category in ${group.name}`}
                    placeholder="Add a category…"
                    value={newCategory[group.id] ?? ''}
                    onChange={(event) =>
                      setNewCategory({ ...newCategory, [group.id]: event.target.value })
                    }
                    className={`${inputClass} w-64`}
                  />
                </form>
              </div>
            ))}
          </div>
        </>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (groupName.trim()) addGroup.mutate()
        }}
        className="mt-8"
      >
        <h2 className="text-sm font-semibold">Add a group</h2>
        <input
          aria-label="New group name"
          placeholder="Group name"
          value={groupName}
          onChange={(event) => setGroupName(event.target.value)}
          className={`${inputClass} mt-2 w-64`}
        />
      </form>
    </section>
  )
}
