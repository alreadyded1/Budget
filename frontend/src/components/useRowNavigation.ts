import { useEffect, useRef } from 'react'

/** True when a key press belongs to whatever is being typed into, not to the page. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

type Options = {
  /** Row ids in display order. */
  ids: number[]
  selected: number | null
  onSelect: (id: number | null) => void
  onOpen: (id: number) => void
  /** Single-key shortcuts that act on the selected row or the page, e.g. `c`, `Delete`. */
  keys?: Record<string, (selected: number | null) => void>
  enabled?: boolean
}

/** Arrow keys and j/k move the selected row, Enter opens it, Esc clears the selection.
 *
 * Listens on the document so it works wherever focus rests, and stands aside whenever
 * focus is in a field so typing a `j` into a memo stays a `j`.
 */
export function useRowNavigation({
  ids,
  selected,
  onSelect,
  onOpen,
  keys = {},
  enabled = true,
}: Options) {
  // Read the latest values from a ref so the listener is attached once.
  const state = useRef({ ids, selected, onSelect, onOpen, keys, enabled })
  useEffect(() => {
    state.current = { ids, selected, onSelect, onOpen, keys, enabled }
  })

  useEffect(() => {
    function handle(event: KeyboardEvent) {
      const { ids, selected, onSelect, onOpen, keys, enabled } = state.current
      if (!enabled || event.defaultPrevented) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isTypingTarget(event.target)) return

      const index = selected === null ? -1 : ids.indexOf(selected)
      switch (event.key) {
        case 'ArrowDown':
        case 'j':
          event.preventDefault()
          if (ids.length > 0) onSelect(ids[Math.min(index + 1, ids.length - 1)])
          return
        case 'ArrowUp':
        case 'k':
          event.preventDefault()
          if (ids.length > 0) onSelect(ids[Math.max(index - 1, 0)])
          return
        case 'Enter':
          // A focused link or button keeps its own Enter.
          if (
            event.target instanceof HTMLAnchorElement ||
            event.target instanceof HTMLButtonElement
          )
            return
          if (selected !== null) {
            event.preventDefault()
            onOpen(selected)
          }
          return
        case 'Escape':
          if (selected !== null) {
            event.preventDefault()
            onSelect(null)
          }
          return
      }
      const action = keys[event.key]
      if (action) {
        event.preventDefault()
        action(selected)
      }
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [])
}
