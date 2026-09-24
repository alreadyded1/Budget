import { describe, expect, it } from 'vitest'

import type { Balance, LedgerPage, Transaction } from '../../api/transactions'
import {
  applyBalances,
  compareTransactions,
  flatRows,
  removeRows,
  shiftBalance,
  upsertRows,
  withRunningBalances,
} from './ledgerCache'
import type { LedgerData } from './ledgerCache'

function tx(id: number, date: string, amount: number): Transaction {
  return {
    id,
    account_id: 1,
    date,
    payee_id: null,
    memo: null,
    amount_cents: amount,
    status: 'uncleared',
    check_number: null,
    transfer_id: null,
    transfer_account_id: null,
    splits: [],
  }
}

function data(pages: Transaction[][], lastCursor: string | null = null): LedgerData {
  return {
    pageParams: pages.map((_, index) => (index === 0 ? null : `c${index}`)),
    pages: pages.map((rows, index): LedgerPage => ({
      items: rows.map((transaction) => ({ transaction, running_balance_cents: null })),
      next_cursor: index === pages.length - 1 ? lastCursor : `c${index + 1}`,
      total_cents: 0,
    })),
  }
}

const ids = (value: LedgerData) => flatRows(value).map((row) => row.transaction.id)

describe('compareTransactions', () => {
  it('puts newer dates first, then higher ids', () => {
    expect(compareTransactions(tx(1, '2026-09-02', 0), tx(2, '2026-09-01', 0))).toBeLessThan(0)
    expect(compareTransactions(tx(5, '2026-09-01', 0), tx(2, '2026-09-01', 0))).toBeLessThan(0)
  })

  it('puts a temporary row above saved rows of the same day', () => {
    expect(compareTransactions(tx(-1, '2026-09-01', 0), tx(999, '2026-09-01', 0))).toBeLessThan(0)
    expect(compareTransactions(tx(-2, '2026-09-01', 0), tx(-1, '2026-09-01', 0))).toBeLessThan(0)
  })
})

describe('upsertRows', () => {
  it('inserts a row where it sorts', () => {
    const before = data([[tx(3, '2026-09-03', 0), tx(1, '2026-09-01', 0)]])
    expect(ids(upsertRows(before, [tx(-1, '2026-09-02', 0)]))).toEqual([3, -1, 1])
  })

  it('replaces a row that already exists instead of duplicating it', () => {
    const before = data([[tx(3, '2026-09-03', 0), tx(1, '2026-09-01', 0)]])
    const after = upsertRows(before, [tx(3, '2026-08-01', -500)])
    expect(ids(after)).toEqual([1, 3])
    expect(flatRows(after)[1].transaction.amount_cents).toBe(-500)
  })

  it('keeps rows in their own page so cursors stay valid', () => {
    const before = data([[tx(4, '2026-09-04', 0)], [tx(2, '2026-09-02', 0)]], 'c2')
    const after = upsertRows(before, [tx(-1, '2026-09-03', 0)])
    expect(after.pages[0].items.map((row) => row.transaction.id)).toEqual([4])
    expect(after.pages[1].items.map((row) => row.transaction.id)).toEqual([-1, 2])
  })

  it('leaves out a row older than the loaded window while more pages wait', () => {
    const before = data([[tx(4, '2026-09-04', 0)]], 'c1')
    expect(ids(upsertRows(before, [tx(-1, '2026-01-01', 0)]))).toEqual([4])
  })

  it('appends an old row once every page is loaded', () => {
    const before = data([[tx(4, '2026-09-04', 0)]], null)
    expect(ids(upsertRows(before, [tx(-1, '2026-01-01', 0)]))).toEqual([4, -1])
  })

  it('fills an empty ledger', () => {
    expect(ids(upsertRows(data([[]]), [tx(-1, '2026-01-01', 0)]))).toEqual([-1])
  })
})

describe('removeRows', () => {
  it('drops the named rows from any page', () => {
    const before = data([[tx(4, '2026-09-04', 0)], [tx(2, '2026-09-02', 0)]])
    expect(ids(removeRows(before, [2]))).toEqual([4])
  })
})

describe('withRunningBalances', () => {
  it('walks down from the current balance, newest first', () => {
    // Opening 1,000.00; -10.00, -20.00, +5.00 → current 975.00
    const rows = data([
      [tx(3, '2026-09-03', 500), tx(2, '2026-09-02', -2000)],
      [tx(1, '2026-09-01', -1000)],
    ])
    const after = withRunningBalances(rows, 97_500)
    expect(flatRows(after).map((row) => row.running_balance_cents)).toEqual([
      97_500, 97_000, 99_000,
    ])
  })

  it('matches the server after an optimistic insert in the middle', () => {
    const rows = data([[tx(3, '2026-09-03', 500), tx(1, '2026-09-01', -1000)]])
    // Inserting -20.00 on 9/2 moves the current balance from 995.00 to 975.00.
    const after = withRunningBalances(upsertRows(rows, [tx(-1, '2026-09-02', -2000)]), 97_500)
    expect(flatRows(after).map((row) => row.running_balance_cents)).toEqual([
      97_500, 97_000, 99_000,
    ])
  })
})

describe('balances', () => {
  const start: Balance[] = [
    { account_id: 1, current_cents: 1000, cleared_cents: 800, reconciled_cents: 500 },
    { account_id: 2, current_cents: 0, cleared_cents: 0, reconciled_cents: 0 },
  ]

  it('moves only what the status touches', () => {
    expect(shiftBalance(start, 1, -100, 'uncleared')[0]).toEqual({
      account_id: 1,
      current_cents: 900,
      cleared_cents: 800,
      reconciled_cents: 500,
    })
    expect(shiftBalance(start, 1, -100, 'cleared')[0].cleared_cents).toBe(700)
    expect(shiftBalance(start, 2, 50, 'reconciled')[1].reconciled_cents).toBe(50)
  })

  it('takes the server balances over the local ones', () => {
    const server = { account_id: 2, current_cents: 7, cleared_cents: 7, reconciled_cents: 0 }
    const extra = { account_id: 3, current_cents: 1, cleared_cents: 1, reconciled_cents: 1 }
    expect(applyBalances(start, [server, extra])).toEqual([start[0], server, extra])
  })
})
