import { describe, expect, it } from 'vitest'

import { parseApr } from './apr'

describe('parseApr', () => {
  it('reads a percent into basis points', () => {
    expect(parseApr('19.99')).toBe(1999)
    expect(parseApr('6%')).toBe(600)
    expect(parseApr('0')).toBe(0)
    expect(parseApr('  ')).toBeNull()
  })

  it('refuses nonsense and negatives', () => {
    expect(parseApr('abc')).toBeUndefined()
    expect(parseApr('-3')).toBeUndefined()
  })
})
