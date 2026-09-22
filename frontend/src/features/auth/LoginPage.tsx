import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'

import { login } from '../../api/auth'
import { ApiRequestError } from '../../api/client'
import { queryKeys } from '../../api/keys'
import { useSession } from './useSession'

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const session = useSession()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.session, result.user)
      navigate(from, { replace: true })
    },
    onError: (error) => {
      setProblem(
        error instanceof ApiRequestError ? error.detail : 'Could not reach the server. Try again.',
      )
      setPassword('')
    },
  })

  // Already signed in: skip the form entirely.
  if (session.data) {
    return <Navigate to={from} replace />
  }

  // Never a native submit; the page must not reload.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setProblem(null)
    mutation.mutate({ username, password })
  }

  return (
    <div className="flex h-full items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Payday Budget
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Sign in to your household.
        </p>

        <label
          htmlFor="username"
          className="mt-6 block text-sm font-medium text-slate-700 dark:text-slate-200"
        >
          Username
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          autoFocus
          required
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:bg-slate-950"
        />

        <label
          htmlFor="password"
          className="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-200"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:bg-slate-950"
        />

        {problem ? (
          <p role="alert" className="mt-3 text-sm text-rose-600 dark:text-rose-400">
            {problem}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="mt-5 w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        >
          {mutation.isPending ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="mt-4 text-xs text-slate-400">
          No account yet? Create the first one on the server with{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-slate-800">pb create-user</code>
          .
        </p>
      </form>
    </div>
  )
}
