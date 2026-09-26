import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { KeyboardEvent, Ref } from 'react'

import { isValidIsoDate, parseDateInput, todayIso } from '../lib/dates'
import { DatePicker } from './DatePicker'

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
 * `YYYY-MM-DD`. The calendar button sits outside the tab order so Tab never stops on it;
 * Alt+↓ in the field opens the calendar from the keyboard.
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
  const wrapper = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const currentToday = today ?? todayIso()
  const resolved = parseDateInput(value, currentToday)

  /** Applies a shortcut and leaves the whole date selected, so the next keystroke
   * (another +, a t, or a typed date) replaces it rather than appending to it. */
  function applyShortcut(input: HTMLInputElement, next: string) {
    flushSync(() => onChange(next))
    input.select()
  }

  // A click anywhere outside the field and its calendar closes the calendar.
  useEffect(() => {
    if (!open) return
    function onPointer(event: MouseEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [open])

  function closePicker() {
    setOpen(false)
    wrapper.current?.querySelector('input')?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      return
    }
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
    <span ref={wrapper} className="relative flex items-center">
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
        aria-expanded={open}
        className="absolute right-1 text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        // Keep focus where it is, so a second click closes the calendar instead of the
        // calendar closing on blur and the click opening it again.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => (open ? closePicker() : setOpen(true))}
      >
        ▾
      </button>
      {open && (
        <DatePicker
          value={resolved !== null && isValidIsoDate(resolved) ? resolved : null}
          today={currentToday}
          onPick={(iso) => {
            onChange(iso)
            closePicker()
          }}
          onClose={closePicker}
          onLeave={() => setOpen(false)}
        />
      )}
    </span>
  )
}
