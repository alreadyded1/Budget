import { PRESETS } from '../../api/reports'
import type { Preset, ReportQuery } from '../../api/reports'
import { isValidIsoDate } from '../../lib/dates'

/** Report filters live in the URL so Back, reload and bookmarks keep them. */

export const DEFAULT_PRESET: Preset = 'month_to_date'

function ids(params: URLSearchParams, key: string): number[] {
  return params
    .getAll(key)
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0)
}

export function queryFromSearch(params: URLSearchParams): ReportQuery {
  const raw = params.get('preset')
  const preset = PRESETS.some((item) => item.key === raw) ? (raw as Preset) : DEFAULT_PRESET
  const from = params.get('from') ?? undefined
  const to = params.get('to') ?? undefined
  return {
    preset,
    from: from && isValidIsoDate(from) ? from : undefined,
    to: to && isValidIsoDate(to) ? to : undefined,
    accountIds: ids(params, 'account'),
    categoryIds: ids(params, 'category'),
    payeeIds: ids(params, 'payee'),
    uncategorized: params.get('uncategorized') === '1',
  }
}

export function searchFromQuery(
  query: ReportQuery,
  extra: Record<string, string> = {},
): URLSearchParams {
  const params = new URLSearchParams()
  params.set('preset', query.preset)
  if (query.preset === 'custom') {
    if (query.from) params.set('from', query.from)
    if (query.to) params.set('to', query.to)
  }
  for (const id of query.accountIds) params.append('account', String(id))
  for (const id of query.categoryIds) params.append('category', String(id))
  for (const id of query.payeeIds) params.append('payee', String(id))
  if (query.uncategorized) params.set('uncategorized', '1')
  for (const [key, value] of Object.entries(extra)) params.set(key, value)
  return params
}

export type Drill = { categoryId?: number | null; payeeId?: number | null }

/** The transaction list behind one row of a spending report, for the exact dates shown. */
export function drillDownSearch(
  query: ReportQuery,
  range: { start: string; end: string },
  drill: Drill,
): string {
  const next: ReportQuery = {
    ...query,
    preset: 'custom',
    from: range.start,
    to: range.end,
    categoryIds: query.categoryIds,
    payeeIds: query.payeeIds,
    uncategorized: false,
  }
  const extra: Record<string, string> = { on_budget: '1' }
  if (drill.categoryId !== undefined) {
    if (drill.categoryId === null) {
      next.categoryIds = []
      next.uncategorized = true
      extra.flow = 'out'
    } else {
      next.categoryIds = [drill.categoryId]
    }
  }
  if (drill.payeeId !== undefined && drill.payeeId !== null) next.payeeIds = [drill.payeeId]
  return searchFromQuery(next, extra).toString()
}
