import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, Ref } from 'react'

import { fuzzyFilter } from '../lib/fuzzy'

export type ComboOption = {
  key: string
  label: string
  group?: string
  hint?: string
}

export const CREATE_KEY = '__create__'

type Props = {
  options: ComboOption[]
  text: string
  onTextChange: (text: string) => void
  /** Called with the chosen option; a create choice has key CREATE_KEY and the typed label. */
  onPick: (option: ComboOption) => void
  allowCreate?: boolean
  /** Options kept at the end of the list whatever their score, e.g. "Split…". */
  pinned?: ComboOption[]
  inputRef?: Ref<HTMLInputElement>
  className?: string
  placeholder?: string
  disabled?: boolean
  'aria-label'?: string
  id?: string
  name?: string
}

const MAX_SHOWN = 50

/** Typeahead for payees, categories and accounts (ARCHITECTURE §Keyboard primitives).
 *
 * - typing opens the list with the best match highlighted
 * - ↓ / ↑ move the highlight (↓ also opens the list)
 * - Tab or Enter with the list open picks the highlighted option; Enter's event is
 *   marked handled so the row does not also save
 * - Esc with the list open closes it and is marked handled; a second Esc reaches the row
 */
export function Combobox({
  options,
  text,
  onTextChange,
  onPick,
  allowCreate = false,
  pinned = [],
  inputRef,
  className = '',
  placeholder,
  disabled,
  ...rest
}: Props) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const listRef = useRef<HTMLUListElement>(null)

  const shown = useMemo(() => {
    const matches = fuzzyFilter(options, text, (option) => option.label).slice(0, MAX_SHOWN)
    const typed = text.trim()
    const exact = options.some((option) => option.label.toLowerCase() === typed.toLowerCase())
    const create: ComboOption[] =
      allowCreate && typed && !exact ? [{ key: CREATE_KEY, label: typed, hint: 'new' }] : []
    // Pinned options filter like the rest, so a typo never quietly picks "Split…".
    return [...matches, ...create, ...fuzzyFilter(pinned, text, (option) => option.label)]
  }, [options, text, allowCreate, pinned])

  useEffect(() => {
    const active = listRef.current?.querySelector('[data-active="true"]')
    if (active && 'scrollIntoView' in active) {
      ;(active as HTMLElement).scrollIntoView?.({ block: 'nearest' })
    }
  }, [highlight, open])

  function pick(index: number) {
    const option = shown[index]
    if (option === undefined) return
    setOpen(false)
    setHighlight(-1)
    onPick(option)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        if (!open) {
          setOpen(true)
          setHighlight(0)
        } else {
          setHighlight((current) => (current + 1) % Math.max(shown.length, 1))
        }
        break
      case 'ArrowUp':
        if (!open) return
        event.preventDefault()
        setHighlight((current) => (current <= 0 ? shown.length - 1 : current - 1))
        break
      case 'Enter':
        if (open && highlight >= 0 && highlight < shown.length) {
          event.preventDefault()
          pick(highlight)
        }
        break
      case 'Tab':
        if (!event.shiftKey && open && highlight >= 0 && highlight < shown.length) {
          pick(highlight)
        }
        setOpen(false)
        break
      case 'Escape':
        if (open) {
          event.preventDefault()
          setOpen(false)
          setHighlight(-1)
        }
        break
    }
  }

  const activeId = open && highlight >= 0 ? `${listId}-${highlight}` : undefined
  let lastGroup: string | undefined

  return (
    <div className="relative">
      <input
        {...rest}
        ref={inputRef}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeId}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        onChange={(event) => {
          onTextChange(event.target.value)
          const typed = event.target.value.trim() !== ''
          setOpen(typed)
          setHighlight(typed ? 0 : -1)
        }}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={() => {
          setOpen(false)
          setHighlight(-1)
        }}
        onKeyDown={handleKeyDown}
      />
      {open && shown.length > 0 && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute top-full left-0 z-30 mt-1 max-h-64 min-w-full overflow-auto rounded border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {shown.map((option, index) => {
            // Group headers only make sense in the list's own order; a ranked list shows
            // the group beside each match instead.
            const filtering = text.trim() !== ''
            const header =
              !filtering && option.group !== undefined && option.group !== lastGroup
                ? option.group
                : null
            lastGroup = option.group
            const hint = option.hint ?? (filtering ? option.group : undefined)
            const active = index === highlight
            return (
              <li key={`${option.key}-${index}`} role="presentation">
                {header && (
                  <div className="px-2 pt-1.5 pb-0.5 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
                    {header}
                  </div>
                )}
                <div
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={active}
                  data-active={active}
                  className={[
                    'flex cursor-pointer items-center justify-between gap-3 px-2 py-1 whitespace-nowrap',
                    active ? 'bg-sky-100 dark:bg-sky-900/60' : '',
                  ].join(' ')}
                  onMouseDown={(event) => {
                    // Keep focus in the input so the pick behaves like a keyboard pick.
                    event.preventDefault()
                    pick(index)
                  }}
                  onMouseEnter={() => setHighlight(index)}
                >
                  <span>
                    {option.key === CREATE_KEY ? `Create '${option.label}'` : option.label}
                  </span>
                  {hint && option.key !== CREATE_KEY && (
                    <span className="text-xs text-slate-400">{hint}</span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
