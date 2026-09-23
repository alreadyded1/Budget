import { describe, expect, it } from 'vitest'

import { formatCents, parseAmountToCents, roundToCents } from './money'

describe('formatCents', () => {
  it('formats whole and part amounts', () => {
    expect(formatCents(0)).toBe('$0.00')
    expect(formatCents(5)).toBe('$0.05')
    expect(formatCents(100)).toBe('$1.00')
    expect(formatCents(12345)).toBe('$123.45')
  })

  it('keeps the sign in front of the symbol', () => {
    expect(formatCents(-12345)).toBe('-$123.45')
    expect(formatCents(-5)).toBe('-$0.05')
  })

  it('groups thousands', () => {
    expect(formatCents(123456789)).toBe('$1,234,567.89')
  })

  it('takes another currency symbol', () => {
    expect(formatCents(1050, '£')).toBe('£10.50')
  })
})

describe('parseAmountToCents', () => {
  it('reads plain numbers', () => {
    expect(parseAmountToCents('12.34')).toBe(1234)
    expect(parseAmountToCents('0.05')).toBe(5)
    expect(parseAmountToCents('7')).toBe(700)
  })

  it('ignores currency symbols, commas and spaces', () => {
    expect(parseAmountToCents(' $1,234.56 ')).toBe(123456)
  })

  it('handles negatives', () => {
    expect(parseAmountToCents('-42.10')).toBe(-4210)
  })

  it('returns null for things that are not amounts', () => {
    expect(parseAmountToCents('')).toBeNull()
    expect(parseAmountToCents('abc')).toBeNull()
    expect(parseAmountToCents('-')).toBeNull()
    expect(parseAmountToCents('1.2.3')).toBeNull()
  })

  it('rounds half away from zero', () => {
    expect(parseAmountToCents('1.005')).toBe(101)
    expect(parseAmountToCents('-1.005')).toBe(-101)
    expect(parseAmountToCents('2.675')).toBe(268)
  })

  it('round-trips through formatCents', () => {
    for (const text of ['0.01', '19.99', '1234.50', '-8.75']) {
      const cents = parseAmountToCents(text)
      expect(cents).not.toBeNull()
      expect(parseAmountToCents(formatCents(cents!))).toBe(cents)
    }
  })
})

describe('roundToCents', () => {
  it('never produces a fractional cent', () => {
    expect(Number.isInteger(roundToCents(1.005))).toBe(true)
    expect(Number.isInteger(roundToCents(-0.001))).toBe(true)
  })
})
