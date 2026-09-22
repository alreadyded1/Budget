import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'

import { isUnauthenticated, useSession } from './useSession'

/** Route guard. Sends anonymous visitors to the login page, remembering where they wanted to go. */
export function RequireSession({ children }: { children: ReactNode }) {
  const location = useLocation()
  const { data, isPending, error } = useSession()

  if (isPending) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading…</div>
    )
  }

  if (!data || isUnauthenticated(error) || error) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }

  return <>{children}</>
}
