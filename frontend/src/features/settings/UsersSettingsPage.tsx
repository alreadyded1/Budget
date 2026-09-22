import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'

import type { User } from '../../api/auth'
import { ApiRequestError } from '../../api/client'
import { queryKeys } from '../../api/keys'
import { createUser, fetchUsers, resetPassword, updateUser } from '../../api/users'
import { useToast } from '../../components/toastContext'
import { useSession } from '../auth/useSession'

const inputClass =
  'rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:bg-slate-950'

function problemText(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError ? error.detail : fallback
}

export function UsersSettingsPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const { data: me } = useSession()
  const { data, isPending } = useQuery({
    queryKey: queryKeys.users,
    queryFn: ({ signal }) => fetchUsers(signal),
  })

  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [resettingId, setResettingId] = useState<number | null>(null)
  const [newPassword, setNewPassword] = useState('')

  const invalidateUsers = () => queryClient.invalidateQueries({ queryKey: queryKeys.users })

  const add = useMutation({
    mutationFn: createUser,
    onSuccess: (user) => {
      setUsername('')
      setDisplayName('')
      setPassword('')
      invalidateUsers()
      toast(`${user.display_name} can now sign in.`, 'success')
    },
    onError: (error) => toast(problemText(error, 'Could not create that user.')),
  })

  const toggleActive = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      updateUser(id, { is_active }),
    onMutate: async ({ id, is_active }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.users })
      const previous = queryClient.getQueryData<{ items: User[] }>(queryKeys.users)
      if (previous) {
        queryClient.setQueryData<{ items: User[] }>(queryKeys.users, {
          items: previous.items.map((user) => (user.id === id ? { ...user, is_active } : user)),
        })
      }
      return { previous }
    },
    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.users, context.previous)
      toast(problemText(error, 'Could not change that account.'))
    },
    onSuccess: () => invalidateUsers(),
  })

  const reset = useMutation({
    mutationFn: ({ id, value }: { id: number; value: string }) => resetPassword(id, value),
    onSuccess: (user) => {
      setResettingId(null)
      setNewPassword('')
      toast(`Password reset for ${user.display_name}.`, 'success')
    },
    onError: (error) => toast(problemText(error, 'Could not reset that password.')),
  })

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    add.mutate({ username, display_name: displayName, password })
  }

  function handleReset(event: FormEvent<HTMLFormElement>, id: number) {
    event.preventDefault()
    reset.mutate({ id, value: newPassword })
  }

  if (isPending || !data) {
    return <p className="text-sm text-slate-500">Loading…</p>
  }

  return (
    <div>
      <ul className="divide-y divide-slate-200 rounded border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
        {data.items.map((user) => (
          <li key={user.id} className="px-3 py-2">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {user.display_name}
                  {user.id === me?.id ? (
                    <span className="ml-2 text-xs font-normal text-slate-400">you</span>
                  ) : null}
                </div>
                <div className="truncate text-xs text-slate-500">@{user.username}</div>
              </div>
              {!user.is_active ? (
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800">
                  disabled
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setResettingId(resettingId === user.id ? null : user.id)
                  setNewPassword('')
                }}
                className="rounded px-2 py-1 text-xs text-slate-600 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Reset password
              </button>
              <button
                type="button"
                onClick={() => toggleActive.mutate({ id: user.id, is_active: !user.is_active })}
                className="rounded px-2 py-1 text-xs text-slate-600 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {user.is_active ? 'Disable' : 'Enable'}
              </button>
            </div>

            {resettingId === user.id ? (
              <form
                onSubmit={(event) => handleReset(event, user.id)}
                className="mt-2 flex items-center gap-2"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setResettingId(null)
                }}
              >
                <input
                  type="password"
                  autoFocus
                  required
                  autoComplete="new-password"
                  placeholder="New password (12+ characters)"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className={`${inputClass} flex-1`}
                />
                <button
                  type="submit"
                  disabled={reset.isPending}
                  className="rounded bg-slate-900 px-2 py-1.5 text-xs font-medium text-white disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setResettingId(null)}
                  className="rounded px-2 py-1.5 text-xs text-slate-500"
                >
                  Cancel
                </button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>

      <form onSubmit={handleAdd} className="mt-6">
        <h2 className="text-sm font-semibold">Add a household member</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <input
            aria-label="Username"
            placeholder="Username"
            required
            autoComplete="off"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className={inputClass}
          />
          <input
            aria-label="Display name"
            placeholder="Display name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className={inputClass}
          />
          <input
            aria-label="Password"
            type="password"
            placeholder="Password (12+ characters)"
            required
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
          />
        </div>
        <button
          type="submit"
          disabled={add.isPending}
          className="mt-3 rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
        >
          Add user
        </button>
      </form>
    </div>
  )
}
