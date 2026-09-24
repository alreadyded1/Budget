import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { KeyboardEvent } from 'react'

import { ApiRequestError } from '../../api/client'
import { DATE_FORMATS, previewCsv } from '../../api/imports'
import type { DateFormat, ProfileFields } from '../../api/imports'
import { formatCents } from '../../lib/money'
import type { LoadedFile } from './readFile'

const LABEL = 'block text-xs font-medium text-slate-500'
const FIELD =
  'mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:bg-slate-950'

const DELIMITER_LABEL: Record<string, string> = {
  ',': 'Comma ,',
  ';': 'Semicolon ;',
  '\t': 'Tab',
  '|': 'Pipe |',
}

type Props = {
  file: LoadedFile
  initialName: string
  initial: ProfileFields
  editing: boolean
  busy: boolean
  onSave: (name: string, profile: ProfileFields) => void
  onBack: () => void
}

/** Map a bank's CSV columns once (SPEC §11). The preview is the server's own parse. */
export function MappingStep({ file, initialName, initial, editing, busy, onSave, onBack }: Props) {
  const [profile, setProfile] = useState<ProfileFields>(initial)
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<ProfileFields>) => setProfile((current) => ({ ...current, ...patch }))

  const preview = useQuery({
    queryKey: ['imports', 'preview', file.name, file.size, profile],
    queryFn: ({ signal }) => previewCsv(file.text, profile, signal),
    placeholderData: keepPreviousData,
    retry: false,
  })
  const columns = preview.data?.columns ?? []
  const previewError =
    preview.error instanceof ApiRequestError
      ? preview.error.detail
      : preview.error
        ? 'Preview failed.'
        : null

  function columnSelect(
    label: string,
    value: number | null,
    onChange: (value: number | null) => void,
    optional = false,
  ) {
    const count = Math.max(columns.length, (value ?? 0) + 1)
    return (
      <label>
        <span className={LABEL}>{label}</span>
        <select
          aria-label={label}
          value={value ?? ''}
          onChange={(event) =>
            onChange(event.target.value === '' ? null : Number(event.target.value))
          }
          className={FIELD}
        >
          {optional && <option value="">None</option>}
          {Array.from({ length: count }, (_, index) => (
            <option key={index} value={index}>
              {index + 1}. {columns[index] ?? `Column ${index + 1}`}
            </option>
          ))}
        </select>
      </label>
    )
  }

  function save() {
    if (!name.trim()) {
      setError('Name this bank format so it can be used again.')
      return
    }
    setError(null)
    onSave(name.trim(), profile)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.isDefaultPrevented()) return
    const target = event.target as HTMLElement
    if (event.key === 'Enter' && target.tagName !== 'BUTTON') {
      event.preventDefault()
      if (!busy) save()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onBack()
    }
  }

  const rows = preview.data?.rows ?? []
  const problems = preview.data?.problems ?? []

  return (
    <div role="group" aria-label="CSV columns" onKeyDown={handleKeyDown} data-testid="mapping-step">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Tell the app which column is which in <span className="font-medium">{file.name}</span>. It
        is saved as a bank format, so next time this step is skipped.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <label className="sm:col-span-2">
          <span className={LABEL}>Bank format name</span>
          <input
            aria-label="Bank format name"
            autoFocus
            value={name}
            placeholder="e.g. Chase checking CSV"
            onChange={(event) => setName(event.target.value)}
            className={FIELD}
          />
        </label>
        <label>
          <span className={LABEL}>Separator</span>
          <select
            aria-label="Separator"
            value={profile.delimiter}
            onChange={(event) => set({ delimiter: event.target.value })}
            className={FIELD}
          >
            {Object.entries(DELIMITER_LABEL).map(([value, label]) => (
              <option key={label} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={LABEL}>Lines to skip at the top</span>
          <input
            aria-label="Lines to skip"
            type="number"
            min={0}
            max={100}
            value={profile.skip_rows}
            onChange={(event) => set({ skip_rows: Math.max(0, Number(event.target.value) || 0) })}
            className={FIELD}
          />
        </label>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={profile.has_header}
          onChange={(event) => set({ has_header: event.target.checked })}
        />
        The first line has column names
      </label>

      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        {columnSelect('Date column', profile.date_column, (value) =>
          set({ date_column: value ?? 0 }),
        )}
        <label>
          <span className={LABEL}>Date format</span>
          <select
            aria-label="Date format"
            value={profile.date_format}
            onChange={(event) => set({ date_format: event.target.value as DateFormat })}
            className={FIELD}
          >
            {DATE_FORMATS.map((format) => (
              <option key={format}>{format}</option>
            ))}
          </select>
        </label>
        {columnSelect('Description column', profile.description_column, (value) =>
          set({ description_column: value ?? 0 }),
        )}
        {columnSelect(
          'Memo column',
          profile.memo_column,
          (value) => set({ memo_column: value }),
          true,
        )}
      </div>

      <fieldset className="mt-3">
        <legend className={LABEL}>Amounts</legend>
        <div className="mt-1 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="amount_mode"
              checked={profile.amount_mode === 'single'}
              onChange={() =>
                set({
                  amount_mode: 'single',
                  amount_column: profile.amount_column ?? profile.debit_column ?? 2,
                })
              }
            />
            One column, spending negative
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="amount_mode"
              checked={profile.amount_mode === 'debit_credit'}
              onChange={() =>
                set({
                  amount_mode: 'debit_credit',
                  debit_column: profile.debit_column ?? profile.amount_column ?? 2,
                  credit_column: profile.credit_column ?? (profile.amount_column ?? 2) + 1,
                })
              }
            />
            Separate money out / money in columns
          </label>
        </div>
      </fieldset>
      <div className="mt-2 grid gap-3 sm:grid-cols-4">
        {profile.amount_mode === 'single' ? (
          columnSelect('Amount column', profile.amount_column, (value) =>
            set({ amount_column: value }),
          )
        ) : (
          <>
            {columnSelect('Money out column', profile.debit_column, (value) =>
              set({ debit_column: value }),
            )}
            {columnSelect('Money in column', profile.credit_column, (value) =>
              set({ credit_column: value }),
            )}
          </>
        )}
        <label className="flex items-end gap-2 pb-1 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={profile.invert_sign}
            onChange={(event) => set({ invert_sign: event.target.checked })}
          />
          Flip the sign (my bank shows purchases as positive)
        </label>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-rose-600">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {editing ? 'Update format and continue' : 'Save format and continue'}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="rounded px-3 py-1.5 text-sm text-slate-600 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Back
        </button>
      </div>

      <h2 className="mt-6 text-sm font-semibold">Preview</h2>
      {previewError && <p className="mt-2 text-sm text-rose-600">{previewError}</p>}
      {problems.length > 0 && (
        <ul
          className="mt-2 text-sm text-amber-700 dark:text-amber-400"
          data-testid="preview-problems"
        >
          {problems.slice(0, 5).map((problem) => (
            <li key={problem.line}>
              {problem.line > 0 ? `Line ${problem.line}: ` : ''}
              {problem.reason}
            </li>
          ))}
          {problems.length > 5 && <li>…and more</li>}
        </ul>
      )}
      <table className="mt-2 w-full text-sm" data-testid="mapping-preview">
        <thead className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800">
          <tr>
            <th className="py-1 pr-2 font-medium">Date</th>
            <th className="py-1 pr-2 font-medium">Description</th>
            <th className="py-1 pr-2 font-medium">Memo</th>
            <th className="py-1 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-slate-100 dark:border-slate-800/70">
              <td className="py-1 pr-2 whitespace-nowrap tabular-nums">{row.date}</td>
              <td className="py-1 pr-2">{row.description}</td>
              <td className="py-1 pr-2 text-slate-500">{row.memo}</td>
              <td
                className={`py-1 text-right tabular-nums ${row.amount_cents < 0 ? '' : 'text-emerald-600'}`}
              >
                {formatCents(row.amount_cents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && !preview.isPending && !previewError && (
        <p className="mt-2 text-sm text-slate-500">No rows read with these settings yet.</p>
      )}
    </div>
  )
}
