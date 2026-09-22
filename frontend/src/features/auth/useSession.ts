import { useQuery } from '@tanstack/react-query'

import { fetchMe } from '../../api/auth'
import { ApiRequestError } from '../../api/client'
import { queryKeys } from '../../api/keys'

/** The signed-in user. A 401 is an answer, not a failure, so it is never retried. */
export function useSession() {
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: ({ signal }) => fetchMe(signal),
    retry: (failureCount, error) => {
      if (error instanceof ApiRequestError && error.status === 401) return false
      return failureCount < 1
    },
    staleTime: 60_000,
  })
}

export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 401
}
