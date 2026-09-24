import { describe, expect, it } from 'vitest'

import { drillDownSearch, queryFromSearch, searchFromQuery } from './query'

describe('report query in the URL', () => {
  it('round-trips', () => {
    const query = {
      preset: 'custom' as const,
      from: '2026-09-01',
      to: '2026-09-30',
      accountIds: [1],
      categoryIds: [2, 3],
      payeeIds: [],
      uncategorized: false,
    }
    expect(queryFromSearch(searchFromQuery(query))).toEqual(query)
  })

  it('falls back to month to date and drops junk', () => {
    const query = queryFromSearch(new URLSearchParams('preset=nope&account=x&from=2026-02-30'))
    expect(query.preset).toBe('month_to_date')
    expect(query.accountIds).toEqual([])
    expect(query.from).toBeUndefined()
  })

  it('drills down to fixed dates, on-budget rows, and the outflows of Uncategorized', () => {
    const base = queryFromSearch(new URLSearchParams('preset=this_period&account=4'))
    const range = { start: '2026-09-11', end: '2026-09-24' }
    expect(drillDownSearch(base, range, { categoryId: 9 })).toBe(
      'preset=custom&from=2026-09-11&to=2026-09-24&account=4&category=9&on_budget=1',
    )
    expect(drillDownSearch(base, range, { categoryId: null })).toBe(
      'preset=custom&from=2026-09-11&to=2026-09-24&account=4&uncategorized=1&on_budget=1&flow=out',
    )
    expect(drillDownSearch(base, range, { payeeId: 5 })).toBe(
      'preset=custom&from=2026-09-11&to=2026-09-24&account=4&payee=5&on_budget=1',
    )
  })
})
