import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

import {
  addMonths,
  dayOfWeek,
  monthGrid,
  monthStart,
  monthTitle,
  weekdayLabels,
} from '../lib/calendar'
import { addDays, isoDate } from '../lib/dates'

type Props = {
  /** The date shown as chosen, or null when the field is empty or unreadable. */
  value: string | null
  today: string
  onPick: (iso: string) => void
  /** Esc or Done: close without picking, back to the field. */
  onClose: () => void
  /** Focus moved to something outside (Tab away): close and leave focus there. Clicks outside
   * are the field's job: Safari gives a clicked button no focus, so blur can't tell them. */
  onLeave: () => void
}

const CELL =
  'h-8 w-8 rounded text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-sky-500'
const SMALL =
  'rounded px-2 py-1 text-xs outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 dark:hover:bg-slate-800'

/** The same day in another month, or that month's last day (Jan 31 → Feb 28). */
function sameDayIn(iso: string, months: number): string {
  const target = addMonths(monthStart(iso), months)
  const [year, month] = target.split('-').map(Number)
  let day = Number(iso.slice(8, 10))
  while (isoDate(year, month, day) === null) day--
  return isoDate(year, month, day)!
}

/** The app's own calendar for date fields (repair list, D-115).
 *
 * Safari keeps its native date popover open after a day is picked, so the date fields use
 * this instead. Picking a day closes it; so do Done, Esc, and clicking or tabbing away.
 * Arrows move a day or a week, Page Up / Page Down a month, Home / End the week's ends,
 * Enter or Space picks. Keys never reach the ledger row around it.
 */
export function DatePicker({ value, today, onPick, onClose, onLeave }: Props) {
  const [active, setActive] = useState(value ?? today)
  const [alignRight, setAlignRight] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const month = monthStart(active)
  const weeks = monthGrid(month)

  // Keep the grid's focus on the active day as it moves.
  useEffect(() => {
    panel.current?.querySelector<HTMLButtonElement>(`[data-date="${active}"]`)?.focus()
  }, [active])

  // Open towards whichever side has room, so a field near the right edge stays on screen.
  useLayoutEffect(() => {
    const box = panel.current?.getBoundingClientRect()
    if (box && box.right > window.innerWidth - 8) setAlignRight(true)
  }, [])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Enter, Esc and the arrows mean something to the row around the field; not here.
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    const inGrid = (event.target as HTMLElement).dataset.date !== undefined
    if (!inGrid) return
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(active, -1),
      ArrowRight: () => addDays(active, 1),
      ArrowUp: () => addDays(active, -7),
      ArrowDown: () => addDays(active, 7),
      PageUp: () => sameDayIn(active, -1),
      PageDown: () => sameDayIn(active, 1),
      Home: () => addDays(active, -dayOfWeek(active)),
      End: () => addDays(active, 6 - dayOfWeek(active)),
    }
    const move = moves[event.key]
    if (move) {
      event.preventDefault()
      setActive(move())
    }
  }

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label="Choose a date"
      data-testid="date-picker"
      onKeyDown={onKeyDown}
      // A click inside never moves focus. Safari doesn't focus a clicked button, so without
      // this the month arrows looked like focus leaving and closed the calendar.
      onMouseDown={(event) => event.preventDefault()}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null
        if (next !== null && !event.currentTarget.contains(next)) onLeave()
      }}
      className={`absolute top-full z-40 mt-1 w-64 rounded border border-slate-200 bg-white p-2 text-slate-900 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${
        alignRight ? 'right-0' : 'left-0'
      }`}
    >
      <div className="flex items-center justify-between">
        <button
          type="button"
          className={SMALL}
          aria-label="Previous month"
          onClick={() => setActive(sameDayIn(active, -1))}
        >
          ‹
        </button>
        <div className="text-sm font-medium" aria-live="polite">
          {monthTitle(month)}
        </div>
        <button
          type="button"
          className={SMALL}
          aria-label="Next month"
          onClick={() => setActive(sameDayIn(active, 1))}
        >
          ›
        </button>
      </div>
      <table role="grid" aria-label={monthTitle(month)} className="mt-1 w-full border-collapse">
        <thead>
          <tr>
            {weekdayLabels().map((label) => (
              <th
                key={label}
                scope="col"
                className="pb-1 text-center text-xs font-normal text-slate-500"
              >
                {label.slice(0, 2)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((day) => {
                const outside = day.slice(0, 7) !== month.slice(0, 7)
                const chosen = day === value
                const isToday = day === today
                return (
                  <td key={day} className="p-0 text-center">
                    <button
                      type="button"
                      data-date={day}
                      tabIndex={day === active ? 0 : -1}
                      aria-pressed={chosen}
                      aria-current={isToday ? 'date' : undefined}
                      aria-label={day}
                      onClick={() => onPick(day)}
                      className={`${CELL} ${
                        chosen
                          ? 'bg-sky-700 font-semibold text-white'
                          : `hover:bg-slate-100 dark:hover:bg-slate-800 ${
                              outside ? 'text-slate-500' : ''
                            } ${isToday ? 'ring-1 ring-slate-400' : ''}`
                      }`}
                    >
                      {Number(day.slice(8, 10))}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2 dark:border-slate-700">
        <button type="button" className={SMALL} onClick={() => onPick(today)}>
          Today
        </button>
        <button
          type="button"
          className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:bg-slate-100 dark:text-slate-900"
          onClick={onClose}
        >
          ✓ Done
        </button>
      </div>
    </div>
  )
}
