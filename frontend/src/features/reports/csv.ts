/** CSV export built in the browser from the rows on screen (D-087). */

export type CsvColumn<Row> = {
  header: string
  value: (row: Row) => string | number | null | undefined
}

/** Cents as a plain signed decimal: -4520 → "-45.20". No currency symbol, no grouping. */
export function centsCsv(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return ''
  const sign = cents < 0 ? '-' : ''
  const magnitude = Math.abs(cents)
  return `${sign}${Math.floor(magnitude / 100)}.${String(magnitude % 100).padStart(2, '0')}`
}

/** Basis points as a percent with one decimal: 2214 → "22.1". */
export function percentCsv(bp: number | null | undefined): string {
  if (bp === null || bp === undefined) return ''
  const sign = bp < 0 ? '-' : ''
  const tenths = Math.round(Math.abs(bp) / 10)
  return `${sign}${Math.floor(tenths / 10)}.${tenths % 10}`
}

function cell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv<Row>(rows: Row[], columns: CsvColumn<Row>[]): string {
  const lines = [columns.map((column) => cell(column.header)).join(',')]
  for (const row of rows) lines.push(columns.map((column) => cell(column.value(row))).join(','))
  return `${lines.join('\r\n')}\r\n`
}

export function csvFilename(report: string, start: string, end: string): string {
  return `${report}_${start}_${end}.csv`
}

/** Hand the file to the browser. */
export function downloadCsv(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
