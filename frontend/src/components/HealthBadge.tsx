import { useQuery } from '@tanstack/react-query'

import { fetchHealth } from '../api/health'
import { queryKeys } from '../api/keys'
import { healthLabel, healthState } from '../lib/health'

const DOT_CLASS: Record<string, string> = {
  loading: 'bg-slate-400 animate-pulse',
  online: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  offline: 'bg-rose-500',
}

export function HealthBadge() {
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: 30_000,
  })

  const state = healthState({ isLoading, isError, status: data?.status })

  return (
    <div className="flex items-center gap-2 text-xs text-slate-400">
      <span
        className={`inline-block h-2 w-2 rounded-full ${DOT_CLASS[state]}`}
        aria-hidden="true"
      />
      <span>{healthLabel(state)}</span>
      {data ? <span className="ml-auto tabular-nums">v{data.version}</span> : null}
    </div>
  )
}
