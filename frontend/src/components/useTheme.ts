import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'

import { queryKeys } from '../api/keys'
import { fetchSettings } from '../api/settings'
import {
  applyTheme,
  readOverride,
  resolveTheme,
  systemPrefersDark,
  writeHousehold,
  writeOverride,
} from '../lib/theme'
import type { ThemeChoice } from '../lib/theme'

/** Applies the theme and keeps it in step with Settings, this browser's choice and the OS. */
export function useTheme() {
  const settings = useQuery({
    queryKey: queryKeys.settings,
    queryFn: ({ signal }) => fetchSettings(signal),
    staleTime: 5 * 60_000,
  })
  const household = settings.data?.theme_default ?? null
  const [override, setOverrideState] = useState<ThemeChoice | null>(() => readOverride())
  const [systemDark, setSystemDark] = useState(() => systemPrefersDark())

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
  }, [])

  useEffect(() => {
    if (household) writeHousehold(household)
  }, [household])

  useEffect(() => {
    applyTheme(resolveTheme(override, household, systemDark))
  }, [override, household, systemDark])

  const setOverride = useCallback((value: ThemeChoice | null) => {
    writeOverride(value)
    setOverrideState(value)
  }, [])

  return { override, household, setOverride }
}
