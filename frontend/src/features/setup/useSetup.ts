import { useQuery } from '@tanstack/react-query'

import { fetchAccounts } from '../../api/accounts'
import { fetchGroups } from '../../api/categories'
import { queryKeys } from '../../api/keys'
import { fetchSchedule } from '../../api/paySchedule'

const SKIP_KEY = 'pb.setup.skipped'

/** Whether the household still needs the first-run wizard (SPEC §17, D-106). */
export function useSetupStatus() {
  const schedule = useQuery({
    queryKey: queryKeys.paySchedule,
    queryFn: ({ signal }) => fetchSchedule(signal),
  })
  const accounts = useQuery({
    queryKey: queryKeys.accounts,
    queryFn: ({ signal }) => fetchAccounts(signal),
  })
  const groups = useQuery({
    queryKey: queryKeys.categoryGroups,
    queryFn: ({ signal }) => fetchGroups(signal),
  })
  const loading = schedule.isPending || accounts.isPending
  const hasSchedule = Boolean(schedule.data?.current)
  const hasAccounts = (accounts.data?.items.length ?? 0) > 0
  const categoryCount = (groups.data?.items ?? []).reduce(
    (sum, group) => sum + group.categories.length,
    0,
  )
  return {
    loading,
    hasSchedule,
    hasAccounts,
    categoryCount,
    needed: !loading && (!hasSchedule || !hasAccounts),
  }
}

export function setupSkipped(): boolean {
  try {
    return window.localStorage.getItem(SKIP_KEY) === '1'
  } catch {
    return false
  }
}

export function skipSetup(skip: boolean): void {
  try {
    if (skip) window.localStorage.setItem(SKIP_KEY, '1')
    else window.localStorage.removeItem(SKIP_KEY)
  } catch {
    // Private windows: the wizard simply shows again next time.
  }
}
