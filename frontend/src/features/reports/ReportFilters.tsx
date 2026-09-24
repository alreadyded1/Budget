import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

import { PRESETS } from '../../api/reports'
import type { Preset, ReportQuery } from '../../api/reports'
import { DateInput } from '../../components/DateInput'
import { parseDateInput, todayIso } from '../../lib/dates'
import { fuzzyFilter } from '../../lib/fuzzy'

const FIELD =
  'rounded border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:bg-slate-950'

export type Choice = { id: number; label: string; group?: string }

type Props = {
  query: ReportQuery
  range: { start: string; end: string } | undefined
  rangeError: string | null
  accounts: Choice[]
  categories: Choice[]
  payees: Choice[]
  onChange: (query: ReportQuery) => void
}

/** One row of filters above every report (SPEC §16): dates, accounts, categories, payees. */
export function ReportFilters({
  query,
  range,
  rangeError,
  accounts,
  categories,
  payees,
  onChange,
}: Props) {
  const [from, setFrom] = useState(query.from ?? range?.start ?? todayIso())
  const [to, setTo] = useState(query.to ?? range?.end ?? todayIso())

  function applyCustom() {
    const start = parseDateInput(from, todayIso())
    const end = parseDateInput(to, todayIso())
    if (start && end) onChange({ ...query, preset: 'custom', from: start, to: end })
  }

  return (
    <div
      className="no-print mt-4 flex flex-wrap items-end gap-3"
      aria-label="Report filters"
      role="group"
    >
      <label className="text-xs text-slate-500">
        Dates
        <select
          aria-label="Date range"
          value={query.preset}
          onChange={(event) => {
            const preset = event.target.value as Preset
            if (preset === 'custom') {
              const start = range?.start ?? todayIso()
              const end = range?.end ?? todayIso()
              setFrom(start)
              setTo(end)
              onChange({ ...query, preset, from: start, to: end })
            } else {
              onChange({ ...query, preset, from: undefined, to: undefined })
            }
          }}
          className={`${FIELD} mt-1 block`}
        >
          {PRESETS.map((preset) => (
            <option key={preset.key} value={preset.key}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>
      {query.preset === 'custom' && (
        <div
          className="flex items-end gap-2"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              applyCustom()
            }
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) applyCustom()
          }}
        >
          <label className="text-xs text-slate-500">
            From
            <DateInput
              aria-label="From"
              value={from}
              onChange={setFrom}
              className={`${FIELD} mt-1 block w-32`}
            />
          </label>
          <label className="text-xs text-slate-500">
            To
            <DateInput
              aria-label="To"
              value={to}
              onChange={setTo}
              className={`${FIELD} mt-1 block w-32`}
            />
          </label>
        </div>
      )}
      <MultiPicker
        label="Accounts"
        choices={accounts}
        selected={query.accountIds}
        onChange={(accountIds) => onChange({ ...query, accountIds })}
      />
      <MultiPicker
        label="Categories"
        choices={categories}
        selected={query.categoryIds}
        onChange={(categoryIds) => onChange({ ...query, categoryIds })}
      />
      <MultiPicker
        label="Payees"
        choices={payees}
        selected={query.payeeIds}
        onChange={(payeeIds) => onChange({ ...query, payeeIds })}
      />
      <span className="pb-1 text-sm text-slate-600 dark:text-slate-300" data-testid="report-range">
        {rangeError ? (
          <span className="text-rose-600">{rangeError}</span>
        ) : range ? (
          `${range.start} to ${range.end}`
        ) : (
          ''
        )}
      </span>
    </div>
  )
}

type PickerProps = {
  label: string
  choices: Choice[]
  selected: number[]
  onChange: (ids: number[]) => void
}

/** A dropdown of checkboxes with a search box. Esc closes it and returns focus. */
function MultiPicker({ label, choices, selected, onChange }: PickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const buttonRef = useRef<HTMLButtonElement>(null)
  const shown = fuzzyFilter(choices, search, (choice) => choice.label)
  const summary =
    selected.length === 0
      ? 'All'
      : selected.length === 1
        ? (choices.find((choice) => choice.id === selected[0])?.label ?? '1 selected')
        : `${selected.length} selected`

  function close() {
    setOpen(false)
    setSearch('')
    buttonRef.current?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  return (
    <div
      className="relative text-xs text-slate-500"
      onKeyDown={handleKeyDown}
      onBlur={(event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false)
          setSearch('')
        }
      }}
    >
      {label}
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-label={`${label}: ${summary}`}
        onClick={() => setOpen(!open)}
        className={`${FIELD} mt-1 block w-40 truncate text-left text-slate-900 dark:text-slate-100`}
      >
        {summary}
      </button>
      {open && (
        <div
          className="absolute top-full left-0 z-30 mt-1 w-64 rounded border border-slate-200 bg-white p-2 text-sm text-slate-900 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          role="group"
          aria-label={`Choose ${label.toLowerCase()}`}
        >
          <input
            autoFocus
            aria-label={`Search ${label.toLowerCase()}`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={`${FIELD} w-full`}
            placeholder="Search…"
          />
          <div className="mt-2 max-h-60 overflow-auto">
            {shown.map((choice) => (
              <label key={choice.id} className="flex items-center gap-2 py-0.5">
                <input
                  type="checkbox"
                  checked={selected.includes(choice.id)}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...selected, choice.id]
                        : selected.filter((id) => id !== choice.id),
                    )
                  }
                />
                <span className="truncate">{choice.label}</span>
                {choice.group && (
                  <span className="ml-auto text-xs text-slate-400">{choice.group}</span>
                )}
              </label>
            ))}
            {shown.length === 0 && <p className="text-slate-500">No match.</p>}
          </div>
          <div className="mt-2 flex justify-between">
            <button
              type="button"
              className="text-xs text-sky-700 underline dark:text-sky-300"
              onClick={() => onChange([])}
            >
              Clear
            </button>
            <button
              type="button"
              className="text-xs text-sky-700 underline dark:text-sky-300"
              onClick={close}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
