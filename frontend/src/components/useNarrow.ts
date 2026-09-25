import { useSyncExternalStore } from 'react'

/** Phones: below Tailwind's `sm` breakpoint (SPEC §18, D-104). */
const QUERY = '(max-width: 639px)'

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function snapshot(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches
}

export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}
