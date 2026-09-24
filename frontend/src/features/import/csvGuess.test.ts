import { describe, expect, it } from 'vitest'

import { guessDateFormat, guessDelimiter, guessProfile, splitLine } from './csvGuess'

const SIGNED = `Date,Description,Amount
09/02/2026,KROGER #0423 CINCINNATI OH,-45.20
09/04/2026,SHELL OIL 5741,"-38.00"
09/10/2026,ACME PAYROLL,"2,500.00"
`

const DEBIT_CREDIT = `Account Summary for ****1234
Posting Date;Debit;Credit;Payee;Details
2026-09-03;89.10;;TARGET 00012;HOUSEHOLD
2026-09-08;12.50;;CORNER BAKERY;
2026-09-12;;200.00;PAYMENT THANK YOU;ONLINE
`

describe('splitLine', () => {
  it('keeps quoted delimiters and doubled quotes', () => {
    expect(splitLine('a,"1,000.00","say ""hi"""', ',')).toEqual(['a', '1,000.00', 'say "hi"'])
  })
})

describe('guessDelimiter', () => {
  it('finds comma, semicolon and tab files', () => {
    expect(guessDelimiter(SIGNED)).toBe(',')
    expect(guessDelimiter(DEBIT_CREDIT)).toBe(';')
    expect(guessDelimiter('a\tb\tc\n1\t2\t3\n')).toBe('\t')
  })
})

describe('guessDateFormat', () => {
  it('prefers US order but switches when a day is over 12', () => {
    expect(guessDateFormat(['09/02/2026', '09/04/2026'])).toBe('MM/DD/YYYY')
    expect(guessDateFormat(['02/09/2026', '25/09/2026'])).toBe('DD/MM/YYYY')
    expect(guessDateFormat(['2026-09-03'])).toBe('YYYY-MM-DD')
    expect(guessDateFormat(['20260903'])).toBe('YYYYMMDD')
    expect(guessDateFormat(['yesterday'])).toBeNull()
  })
})

describe('guessProfile', () => {
  it('maps a signed-amount file', () => {
    expect(guessProfile(SIGNED)).toMatchObject({
      delimiter: ',',
      skip_rows: 0,
      has_header: true,
      date_column: 0,
      date_format: 'MM/DD/YYYY',
      amount_mode: 'single',
      amount_column: 2,
      description_column: 1,
      memo_column: null,
    })
  })

  it('maps a debit/credit file with a title line', () => {
    expect(guessProfile(DEBIT_CREDIT)).toMatchObject({
      delimiter: ';',
      skip_rows: 1,
      date_format: 'YYYY-MM-DD',
      amount_mode: 'debit_credit',
      amount_column: null,
      debit_column: 1,
      credit_column: 2,
      description_column: 3,
      memo_column: 4,
    })
  })

  it('notices a file without a header', () => {
    expect(guessProfile('09/02/2026,TEA,-4.00\n09/03/2026,CAKE,-3.00\n').has_header).toBe(false)
  })
})

describe('decodeBytes', () => {
  it('reads UTF-8 and falls back to Windows-1252', async () => {
    const { decodeBytes } = await import('./readFile')
    expect(decodeBytes(new TextEncoder().encode('﻿Café').buffer as ArrayBuffer)).toBe('Café')
    expect(decodeBytes(new Uint8Array([0x43, 0x61, 0x66, 0xe9]).buffer)).toBe('Café')
  })
})
