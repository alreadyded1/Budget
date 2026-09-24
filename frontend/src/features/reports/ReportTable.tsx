import type { ReactNode } from 'react'

import { csvFilename, downloadCsv, toCsv } from './csv'

export type Column<Row> = {
  header: string
  cell: (row: Row) => ReactNode
  /** The value in the CSV; plain text, numbers as plain decimals. */
  csv: (row: Row) => string | number | null | undefined
  align?: 'right'
}

type Props<Row> = {
  rows: Row[]
  columns: Column<Row>[]
  rowKey: (row: Row, index: number) => string | number
  /** File name stem and range for the CSV. */
  report: string
  range: { start: string; end: string }
  footer?: ReactNode
  caption?: string
}

/** Every report table: the same rows on screen and in the CSV (SPEC §16). */
export function ReportTable<Row>({
  rows,
  columns,
  rowKey,
  report,
  range,
  footer,
  caption,
}: Props<Row>) {
  return (
    <div className="mt-4">
      <div className="no-print flex justify-end">
        <button
          type="button"
          onClick={() =>
            downloadCsv(
              csvFilename(report, range.start, range.end),
              toCsv(
                rows,
                columns.map((column) => ({ header: column.header, value: column.csv })),
              ),
            )
          }
          className="rounded border border-slate-300 px-2 py-1 text-xs outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          Export CSV
        </button>
      </div>
      <table className="mt-2 w-full text-sm" data-testid={`${report}-table`}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800">
          <tr>
            {columns.map((column) => (
              <th
                key={column.header}
                className={`py-1 pr-3 font-medium ${column.align === 'right' ? 'text-right' : ''}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={rowKey(row, index)}
              className="border-b border-slate-100 dark:border-slate-800/70"
            >
              {columns.map((column) => (
                <td
                  key={column.header}
                  className={`py-1 pr-3 ${column.align === 'right' ? 'text-right tabular-nums' : ''}`}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot className="font-medium">{footer}</tfoot>}
      </table>
      {rows.length === 0 && <p className="mt-2 text-sm text-slate-500">Nothing in this range.</p>}
    </div>
  )
}
