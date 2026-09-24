import { describe, expect, it } from 'vitest'

import { reportParams } from '../../api/reports'
import { centsCsv, csvFilename, percentCsv, toCsv } from './csv'

describe('csv', () => {
  it('writes cents as plain signed decimals', () => {
    expect(centsCsv(-4520)).toBe('-45.20')
    expect(centsCsv(250000)).toBe('2500.00')
    expect(centsCsv(5)).toBe('0.05')
    expect(centsCsv(null)).toBe('')
  })

  it('writes basis points as a percent with one decimal', () => {
    expect(percentCsv(2214)).toBe('22.1')
    expect(percentCsv(8195)).toBe('82.0')
    expect(percentCsv(-45)).toBe('-0.5')
    expect(percentCsv(null)).toBe('')
  })

  it('quotes cells that need it', () => {
    const text = toCsv(
      [{ name: 'Kroger, "Main St"', cents: -4520 }],
      [
        { header: 'Payee', value: (row) => row.name },
        { header: 'Amount', value: (row) => centsCsv(row.cents) },
      ],
    )
    expect(text).toBe('Payee,Amount\r\n"Kroger, ""Main St""",-45.20\r\n')
  })

  it('names the file after the report and range', () => {
    expect(csvFilename('spending-by-category', '2026-09-01', '2026-09-30')).toBe(
      'spending-by-category_2026-09-01_2026-09-30.csv',
    )
  })
})

describe('reportParams', () => {
  it('sends a preset or a custom range, and repeats list filters', () => {
    expect(
      reportParams({ preset: 'last_month', accountIds: [1, 2], categoryIds: [], payeeIds: [7] }),
    ).toBe('preset=last_month&account_id=1&account_id=2&payee_id=7')
    expect(
      reportParams(
        {
          preset: 'custom',
          from: '2026-09-01',
          to: '2026-09-30',
          accountIds: [],
          categoryIds: [3],
          payeeIds: [],
        },
        { by: 'period' },
      ),
    ).toBe('from=2026-09-01&to=2026-09-30&category_id=3&by=period')
  })
})

describe('compactCents', () => {
  it('shortens axis ticks', async () => {
    const { compactCents } = await import('./chartFormat')
    expect(compactCents(45_020)).toBe('$450')
    expect(compactCents(-123_456)).toBe('-$1.2k')
    expect(compactCents(2_500_000)).toBe('$25k')
    expect(compactCents(310_000_000)).toBe('$3.1M')
  })
})
