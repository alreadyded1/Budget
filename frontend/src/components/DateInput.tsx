import { useRef } from 'react'
import { flushSync } from 'react-dom'
import type { KeyboardEvent, Ref } from 'react'

import { isValidIsoDate, parseDateInput, todayIso } from '../lib/dates'

type Props = {
  value: string
  onChange: (value: string) => void
  inputRef?: Ref<HTMLInputElement>
  today?: string
  className?: string
  'aria-label'?: string
  'aria-invalid'?: boolean
  id?: string
  name?: string
  placeholder?: string
}

/** A date field with typing shortcuts: `t`, `+`, `-`, `15`, `3/15`, full dates (SPEC §7).
 *
 * The text stays what was typed until the field loses focus, then settles into
 * `YYYY-MM-DD`. The calendar button sits outside the tab order so Tab never stops on it.
 */
export function DateInput({
  value,
  onChange,
  inputRef,
  today,
  className = '',
  placeholder = 'YYYY-MM-DD',
  ...rest
}: Props) {
  const pickerRef = useRef<HTMLInputElement>(null)
  const currentToday = today ?? todayIso()
  const resolved = parseDateInput(value, currentToday)

  /** Applies a shortcut and leaves the whole date selected, so the next keystroke
   * (another +, a t, or a typed date) replaces it rather than appending to it. */
  function applyShortcut(input: HTMLInputElement, next: string) {
    flushSync(() => onChange(next))
    input.select()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const input = event.currentTarget
    if (event.key === '+' || event.key === '=' || event.key === '-') {
      // `-` is also the ISO separator; only step when the field already reads as a date.
      if (event.key === '-' && resolved === null && value.trim() !== '') return
      event.preventDefault()
      const step = event.key === '-' ? '-' : '+'
      applyShortcut(
        input,
        parseDateInput(step, currentToday, resolved ?? undefined) ?? currentToday,
      )
    } else if (event.key === 't' || event.key === 'T') {
      event.preventDefault()
      applyShortcut(input, currentToday)
    }
  }

  return (
    <span className="relative flex items-center">
      <input
        {...rest}
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        className={`${className} pr-6`}
        onChange={(event) => onChange(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (resolved !== null && resolved !== value) onChange(resolved)
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Open calendar"
        className="absolute right-1 text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        onClick={() => {
          const picker = pickerRef.current
          if (picker === null) return
          try {
            picker.showPicker()
          } catch {
            picker.focus()
          }
        }}
      >
        ▾
      </button>
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute right-0 bottom-0 h-0 w-0 opacity-0"
        value={resolved !== null && isValidIsoDate(resolved) ? resolved : ''}
        onChange={(event) => {
          if (event.target.value) onChange(event.target.value)
        }}
      />
    </span>
  )
}
