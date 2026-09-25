import { useEffect, useRef } from 'react'

const SHORTCUTS: [string, string][] = [
  ['n', 'Focus the entry row'],
  ['/', 'Focus search'],
  ['↓ ↑  or  j k', 'Select the next / previous row'],
  ['Enter', 'Edit the selected row · save the row being typed'],
  ['Esc', 'Close a dropdown · clear or cancel the row · clear the selection'],
  ['c', 'Toggle cleared on the selected row'],
  ['Delete', 'Delete the selected row (Undo for 5 seconds)'],
  ['u', 'Undo the last delete'],
  ['r', 'Receipts of the selected row: view, add, delete'],
  ['Tab / Shift+Tab', 'Next / previous field; Tab picks a highlighted suggestion'],
  ['Date: t + - 15 3/15', 'Today, next / previous day, a day this month, a date this year'],
  ['Amounts: 12.50+3.25', 'Simple math, rounded to cents'],
  ['+ in Outflow', 'Moves the amount to Inflow'],
  ['?', 'Show or hide this list'],
]

export function ShortcutOverlay({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => closeRef.current?.focus(), [])

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === '?') {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <div
        className="w-[34rem] rounded-lg bg-white p-5 shadow-xl dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Keyboard shortcuts</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded px-2 py-0.5 text-sm text-slate-500 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </div>
        <dl className="grid grid-cols-[11rem_1fr] gap-x-4 gap-y-1.5 text-sm">
          {SHORTCUTS.map(([keys, action]) => (
            <div key={keys} className="contents">
              <dt>
                <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-800">
                  {keys}
                </kbd>
              </dt>
              <dd className="text-slate-600 dark:text-slate-300">{action}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
