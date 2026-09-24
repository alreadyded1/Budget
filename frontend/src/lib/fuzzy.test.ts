import { describe, expect, it } from 'vitest'

import { fuzzyFilter, fuzzyScore } from './fuzzy'

describe('fuzzyScore', () => {
  it('ranks exact over prefix over word start over substring over subsequence', () => {
    const exact = fuzzyScore('kroger', 'Kroger')!
    const prefix = fuzzyScore('kro', 'Kroger')!
    const word = fuzzyScore('fuel', 'Kroger Fuel')!
    const inner = fuzzyScore('oge', 'Kroger')!
    const scattered = fuzzyScore('krgr', 'Kroger')!
    expect(exact).toBeGreaterThan(prefix)
    expect(prefix).toBeGreaterThan(word)
    expect(word).toBeGreaterThan(inner)
    expect(inner).toBeGreaterThan(scattered)
  })

  it('returns null when the letters are not there in order', () => {
    expect(fuzzyScore('xyz', 'Kroger')).toBeNull()
    expect(fuzzyScore('rk', 'Kroger')).toBeNull()
  })

  it('treats an empty query as matching everything equally', () => {
    expect(fuzzyScore('', 'Kroger')).toBe(0)
    expect(fuzzyScore('  ', 'Kroger')).toBe(0)
  })
})

describe('fuzzyFilter', () => {
  const names = ['Target', 'Kroger Fuel', 'Kroger', 'Amazon', 'Transfer: Savings']

  it('orders the best match first', () => {
    expect(fuzzyFilter(names, 'kroger', (name) => name)).toEqual(['Kroger', 'Kroger Fuel'])
  })

  it('finds transfer targets by account name', () => {
    expect(fuzzyFilter(names, 'sav', (name) => name)[0]).toBe('Transfer: Savings')
  })

  it('keeps everything, in order, for an empty query', () => {
    expect(fuzzyFilter(names, '', (name) => name)).toEqual(names)
  })
})
