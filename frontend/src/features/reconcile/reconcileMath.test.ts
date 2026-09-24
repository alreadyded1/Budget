import { describe, expect, it } from 'vitest'

import type { Transaction } from '../../api/transactions'
import { difference, statementCents, tickedCents, typedCents } from './reconcileMath'

function tx(amount_cents: number, status: Transaction['status']): Transaction {
  return { amount_cents, status } as Transaction
}

describe('reconcile math', () => {
  it('reads a card statement as money owed', () => {
    expect(statementCents(51230, true)).toBe(-51230)
    expect(statementCents(51230, false)).toBe(51230)
    expect(typedCents(-51230, true)).toBe(51230)
  })

  it('adds only the ticked rows', () => {
    const rows = [tx(-4520, 'cleared'), tx(250000, 'uncleared'), tx(-100, 'cleared')]
    expect(tickedCents(rows)).toBe(-4620)
    expect(difference(100000 - 4620, 100000, rows)).toBe(0)
    expect(difference(100000, 100000, rows)).toBe(4620)
  })
})
