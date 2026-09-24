import { describe, expect, it } from 'vitest'

import { evaluateAmount, isExpression } from './amountExpr'

describe('evaluateAmount', () => {
  it('reads the plain formats SPEC §7 lists', () => {
    expect(evaluateAmount('12.5')).toBe(1250)
    expect(evaluateAmount('$12.50')).toBe(1250)
    expect(evaluateAmount('1,234.56')).toBe(123456)
    expect(evaluateAmount('12')).toBe(1200)
    expect(evaluateAmount('.99')).toBe(99)
    expect(evaluateAmount('7.')).toBe(700)
    expect(evaluateAmount(' 3 ')).toBe(300)
  })

  it('does simple math', () => {
    expect(evaluateAmount('12.50+3.25')).toBe(1575)
    expect(evaluateAmount('20-4.01')).toBe(1599)
    expect(evaluateAmount('3*4.25')).toBe(1275)
    expect(evaluateAmount('2x4')).toBe(800)
    expect(evaluateAmount('10 + 2 * 3')).toBe(1600)
    expect(evaluateAmount('(10+2)*3')).toBe(3600)
    expect(evaluateAmount('$1,000 - $250.75')).toBe(74925)
  })

  it('rounds division to cents, half away from zero', () => {
    expect(evaluateAmount('100/3')).toBe(3333)
    expect(evaluateAmount('200/3')).toBe(6667)
    expect(evaluateAmount('0.05/2')).toBe(3) // 2.5 cents rounds up
    expect(evaluateAmount('-0.05/2')).toBe(-3) // and away from zero when negative
    expect(evaluateAmount('1/8')).toBe(13)
  })

  it('keeps sub-cent input exact until the final rounding', () => {
    expect(evaluateAmount('1.005')).toBe(101)
    expect(evaluateAmount('0.1+0.2')).toBe(30)
    expect(evaluateAmount('1.004')).toBe(100)
    expect(evaluateAmount('0.333*3')).toBe(100)
  })

  it('handles signs', () => {
    expect(evaluateAmount('-5')).toBe(-500)
    expect(evaluateAmount('+5')).toBe(500)
    expect(evaluateAmount('10--5')).toBe(1500)
    expect(evaluateAmount('-0')).toBe(0)
    expect(Object.is(evaluateAmount('-0'), -0)).toBe(false)
  })

  it('refuses what is not arithmetic', () => {
    expect(evaluateAmount('')).toBeNull()
    expect(evaluateAmount('abc')).toBeNull()
    expect(evaluateAmount('12..5')).toBeNull()
    expect(evaluateAmount('5+')).toBeNull()
    expect(evaluateAmount('*5')).toBeNull()
    expect(evaluateAmount('5/0')).toBeNull()
    expect(evaluateAmount('(5+1')).toBeNull()
    expect(evaluateAmount('5+1)')).toBeNull()
    expect(evaluateAmount('1e3')).toBeNull()
  })

  it('stays exact on large amounts', () => {
    expect(evaluateAmount('9,999,999.99')).toBe(999999999)
    expect(evaluateAmount('123456789.01+0.01')).toBe(12345678902)
  })
})

describe('isExpression', () => {
  it('tells an expression from a number', () => {
    expect(isExpression('12+3')).toBe(true)
    expect(isExpression('100/3')).toBe(true)
    expect(isExpression('12.50')).toBe(false)
    expect(isExpression('-12')).toBe(false)
    expect(isExpression('$1,234')).toBe(false)
  })
})
