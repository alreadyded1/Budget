import { DATE_FORMATS, DEFAULT_PROFILE } from '../../api/imports'
import type { DateFormat, ProfileFields } from '../../api/imports'

/** First guesses for a new CSV profile. The mapping screen shows a live preview, so a
 * wrong guess costs one dropdown change, never a bad import. */

const DELIMITERS = [',', ';', '\t', '|'] as const

/** Split one CSV line, honouring double quotes. Good enough for guessing; the server parses. */
export function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"'
        index++
      } else {
        quoted = !quoted
      }
    } else if (char === delimiter && !quoted) {
      cells.push(cell)
      cell = ''
    } else {
      cell += char
    }
  }
  cells.push(cell)
  return cells.map((value) => value.trim())
}

function lines(text: string): string[] {
  return text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
}

/** The delimiter that splits most lines into the same, largest number of cells. */
export function guessDelimiter(text: string): string {
  const sample = lines(text).slice(0, 20)
  let best: string = ','
  let bestScore = 0
  for (const delimiter of DELIMITERS) {
    const counts = sample.map((line) => splitLine(line, delimiter).length)
    const common = mode(counts)
    if (common < 2) continue
    const score = counts.filter((count) => count === common).length * common
    if (score > bestScore) {
      best = delimiter
      bestScore = score
    }
  }
  return best
}

function mode(values: number[]): number {
  const tally = new Map<number, number>()
  for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1)
  let best = 0
  let bestCount = 0
  for (const [value, count] of tally) {
    if (count > bestCount || (count === bestCount && value > best)) {
      best = value
      bestCount = count
    }
  }
  return best
}

/** Lines before the header that have fewer cells than the data (a bank's title line). */
export function guessSkipRows(text: string, delimiter: string): number {
  const sample = lines(text).slice(0, 20)
  const width = mode(sample.map((line) => splitLine(line, delimiter).length))
  const first = sample.findIndex((line) => splitLine(line, delimiter).length === width)
  return Math.max(first, 0)
}

const PATTERNS: Record<DateFormat, RegExp> = {
  'YYYY-MM-DD': /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
  'MM/DD/YYYY': /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
  'DD/MM/YYYY': /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
  'MM/DD/YY': /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/,
  'DD/MM/YY': /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/,
  'DD.MM.YYYY': /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/,
  YYYYMMDD: /^(\d{4})(\d{2})(\d{2})$/,
  'MM-DD-YYYY': /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
}

function fits(format: DateFormat, value: string): boolean {
  const found = PATTERNS[format].exec(value.trim())
  if (!found) return false
  const [a, b, c] = found.slice(1).map(Number)
  const [month, day] = format.startsWith('DD')
    ? [b, a]
    : format.startsWith('YYYY')
      ? [b, c]
      : [a, b]
  return month >= 1 && month <= 12 && day >= 1 && day <= 31
}

/** The first format (US order first) every sample date fits, or null. */
export function guessDateFormat(values: string[]): DateFormat | null {
  const samples = values.filter((value) => value.trim() !== '')
  if (samples.length === 0) return null
  return DATE_FORMATS.find((format) => samples.every((value) => fits(format, value))) ?? null
}

function find(header: string[], ...words: string[]): number | null {
  const lower = header.map((name) => name.toLowerCase())
  for (const word of words) {
    const index = lower.findIndex((name) => name.includes(word))
    if (index >= 0) return index
  }
  return null
}

/** A starting profile from the file's text: delimiter, preamble, header names, date format. */
export function guessProfile(text: string): ProfileFields {
  const delimiter = guessDelimiter(text)
  const skip_rows = guessSkipRows(text, delimiter)
  const rows = lines(text)
    .slice(skip_rows)
    .map((line) => splitLine(line, delimiter))
  const header = rows[0] ?? []
  const has_header = header.length > 0 && guessDateFormat([header[0] ?? '']) === null
  const data = has_header ? rows.slice(1, 11) : rows.slice(0, 10)

  const date_column = find(header, 'posting date', 'post date', 'date') ?? 0
  const debit_column = find(header, 'debit', 'withdrawal', 'money out')
  const credit_column = find(header, 'credit', 'deposit', 'money in')
  const amount_column = find(header, 'amount')
  const description_column =
    find(header, 'description', 'payee', 'name', 'merchant', 'details') ??
    (date_column === 1 ? 0 : 1)
  let memo_column = find(header, 'memo', 'note', 'details', 'reference')
  if (memo_column === description_column) memo_column = null
  const single = amount_column !== null || debit_column === null || credit_column === null

  return {
    ...DEFAULT_PROFILE,
    delimiter,
    skip_rows,
    has_header,
    date_column,
    date_format:
      guessDateFormat(data.map((row) => row[date_column] ?? '')) ?? DEFAULT_PROFILE.date_format,
    amount_mode: single ? 'single' : 'debit_credit',
    amount_column: single ? (amount_column ?? DEFAULT_PROFILE.amount_column) : null,
    debit_column: single ? null : debit_column,
    credit_column: single ? null : credit_column,
    description_column,
    memo_column,
  }
}
