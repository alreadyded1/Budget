/** Pure edits to the cached ledger, used by the optimistic updates (ARCHITECTURE §Frontend).
 *
 * The cache is TanStack Query's infinite data: pages of rows, newest first, each page
 * ending at the cursor the server gave it. Rows are inserted into the page they sort
 * into, never shuffled between pages, so every cursor keeps pointing at its own row.
 */

import type { InfiniteData } from '@tanstack/react-query'

import type { Balance, LedgerPage, LedgerRow, Transaction } from '../../api/transactions'

export type LedgerData = InfiniteData<LedgerPage>

/** A temporary id sorts above every saved row, the newest temporary one first. */
function sortId(id: number): number {
  return id < 0 ? 2 ** 52 - id : id
}

/** Negative when `a` sits above `b` in the ledger (newest first, then highest id). */
export function compareTransactions(a: Transaction, b: Transaction): number {
  if (a.date !== b.date) return a.date > b.date ? -1 : 1
  return sortId(b.id) - sortId(a.id)
}

export function flatRows(data: LedgerData | undefined): LedgerRow[] {
  return data?.pages.flatMap((page) => page.items) ?? []
}

/** Sets one row's receipt count after an upload or delete, wherever it is cached. */
export function withAttachmentCount(data: LedgerData, id: number, count: number): LedgerData {
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((row) =>
        row.transaction.id === id
          ? { ...row, transaction: { ...row.transaction, attachment_count: count } }
          : row,
      ),
    })),
  }
}

export function removeRows(data: LedgerData, ids: Iterable<number>): LedgerData {
  const gone = new Set(ids)
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.filter((row) => !gone.has(row.transaction.id)),
    })),
  }
}

/** Puts each row where it sorts, replacing any row with the same id.
 *
 * A row that sorts below everything loaded, while older pages still wait on the
 * server, is left out: it will arrive with its own page.
 */
export function upsertRows(data: LedgerData, transactions: Transaction[]): LedgerData {
  let next = removeRows(
    data,
    transactions.map((row) => row.id),
  )
  for (const transaction of transactions) {
    const row: LedgerRow = { transaction, running_balance_cents: null }
    const pages = next.pages.map((page) => ({ ...page, items: [...page.items] }))
    let placed = false
    for (const page of pages) {
      const at = page.items.findIndex(
        (existing) => compareTransactions(transaction, existing.transaction) < 0,
      )
      if (at >= 0) {
        page.items.splice(at, 0, row)
        placed = true
        break
      }
    }
    const last = pages[pages.length - 1]
    if (!placed && last !== undefined && last.next_cursor === null) {
      last.items.push(row)
    }
    next = { ...next, pages }
  }
  return next
}

/** Rewrites every running balance from the account's current balance.
 *
 * The current balance is the opening balance plus every transaction, and the ledger is
 * loaded newest first from the top, so each row's balance is the current balance less
 * everything above it. Only valid for one account with no filters applied.
 */
export function withRunningBalances(data: LedgerData, currentCents: number): LedgerData {
  let running = currentCents
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((row) => {
        const balance = running
        running -= row.transaction.amount_cents
        return { ...row, running_balance_cents: balance }
      }),
    })),
  }
}

/** Clears running balances, for views where a number would mislead. */
export function withoutRunningBalances(data: LedgerData): LedgerData {
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((row) => ({ ...row, running_balance_cents: null })),
    })),
  }
}

export function findRow(data: LedgerData | undefined, id: number): LedgerRow | undefined {
  return flatRows(data).find((row) => row.transaction.id === id)
}

// --------------------------------------------------------------------------- balances

/** Moves an account's balances by `delta`, the way saving `status` money would. */
export function shiftBalance(
  balances: Balance[],
  accountId: number,
  delta: number,
  status: Transaction['status'],
): Balance[] {
  return balances.map((balance) => {
    if (balance.account_id !== accountId) return balance
    return {
      ...balance,
      current_cents: balance.current_cents + delta,
      cleared_cents: balance.cleared_cents + (status === 'uncleared' ? 0 : delta),
      reconciled_cents: balance.reconciled_cents + (status === 'reconciled' ? delta : 0),
    }
  })
}

/** Takes the server's word for every balance it sent back. */
export function applyBalances(balances: Balance[], updates: Balance[]): Balance[] {
  const byId = new Map(updates.map((balance) => [balance.account_id, balance]))
  const merged = balances.map((balance) => byId.get(balance.account_id) ?? balance)
  const known = new Set(balances.map((balance) => balance.account_id))
  return [...merged, ...updates.filter((balance) => !known.has(balance.account_id))]
}
