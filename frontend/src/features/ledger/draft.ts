/** The entry row's state, and how it becomes an API call (SPEC §7).
 *
 * Kept free of React so the rules — which field wins, how a transfer is recognised,
 * what a split must add up to — can be tested directly.
 */

import type { Account } from '../../api/accounts'
import type { Payee } from '../../api/payees'
import type {
  SplitInput,
  Transaction,
  TransactionInput,
  TransferInput,
} from '../../api/transactions'
import { evaluateAmount } from '../../lib/amountExpr'
import { parseDateInput } from '../../lib/dates'

export const TRANSFER_PREFIX = 'Transfer: '
export const SPLIT_LABEL = 'Split…'

export type CategoryOption = { id: number; name: string; groupName: string }

export type SplitDraft = {
  key: number
  categoryText: string
  categoryId: number | null
  memo: string
  /** A positive amount in the same direction as the whole transaction. */
  amount: string
}

export type Draft = {
  accountId: number | null
  accountText: string
  date: string
  payeeText: string
  payeeId: number | null
  transferAccountId: number | null
  categoryText: string
  categoryId: number | null
  memo: string
  outflow: string
  inflow: string
  splits: SplitDraft[] | null
}

export type FieldName =
  | 'account'
  | 'date'
  | 'payee'
  | 'category'
  | 'memo'
  | 'outflow'
  | 'inflow'
  | `split-${number}-category`
  | `split-${number}-amount`

export type Lookups = {
  accounts: Account[]
  payees: Payee[]
  categories: CategoryOption[]
  today: string
}

export type SavePlan =
  | { kind: 'transaction'; body: TransactionInput; newPayeeName: string | null }
  | { kind: 'transfer'; body: TransferInput }

export type BuildResult =
  { ok: true; plan: SavePlan } | { ok: false; field: FieldName; message: string }

let nextSplitKey = 1

export function newSplit(amount = ''): SplitDraft {
  return { key: nextSplitKey++, categoryText: '', categoryId: null, memo: '', amount }
}

export function emptyDraft(date: string, account: Account | null = null): Draft {
  return {
    accountId: account?.id ?? null,
    accountText: account?.name ?? '',
    date,
    payeeText: '',
    payeeId: null,
    transferAccountId: null,
    categoryText: '',
    categoryId: null,
    memo: '',
    outflow: '',
    inflow: '',
    splits: null,
  }
}

/** Cents as the plain text an amount field holds: 1234 → "12.34". */
export function centsToInput(cents: number): string {
  const magnitude = Math.abs(cents)
  return `${Math.floor(magnitude / 100)}.${String(magnitude % 100).padStart(2, '0')}`
}

export function transferLabel(account: Account): string {
  return `${TRANSFER_PREFIX}${account.name}`
}

/** The draft an existing row opens with when it is edited inline. */
export function draftFromTransaction(transaction: Transaction, lookups: Lookups): Draft {
  const account = lookups.accounts.find((row) => row.id === transaction.account_id)
  const partner = lookups.accounts.find((row) => row.id === transaction.transfer_account_id)
  const payee = lookups.payees.find((row) => row.id === transaction.payee_id)
  const single = transaction.splits.length === 1 ? transaction.splits[0] : null
  const category = lookups.categories.find((row) => row.id === single?.category_id)
  const amount = transaction.amount_cents

  return {
    accountId: transaction.account_id,
    accountText: account?.name ?? '',
    date: transaction.date,
    payeeText: partner ? transferLabel(partner) : (payee?.name ?? ''),
    payeeId: payee?.id ?? null,
    transferAccountId: partner?.id ?? null,
    categoryText: transaction.splits.length > 1 ? SPLIT_LABEL : (category?.name ?? ''),
    categoryId: category?.id ?? null,
    memo: transaction.memo ?? '',
    outflow: amount < 0 ? centsToInput(amount) : '',
    inflow: amount > 0 ? centsToInput(amount) : '',
    splits:
      transaction.splits.length > 1
        ? transaction.splits.map((split) => {
            const splitCategory = lookups.categories.find((row) => row.id === split.category_id)
            return {
              ...newSplit(centsToInput(split.amount_cents)),
              categoryText: splitCategory?.name ?? '',
              categoryId: splitCategory?.id ?? null,
              memo: split.memo ?? '',
            }
          })
        : null,
  }
}

/** The signed amount the outflow and inflow fields add up to, or null if unreadable. */
export function draftAmount(draft: Draft): number | null {
  const out = draft.outflow.trim() ? evaluateAmount(draft.outflow) : 0
  const into = draft.inflow.trim() ? evaluateAmount(draft.inflow) : 0
  if (out === null || into === null) return null
  return into - out
}

/** What the split lines still need to cover, in positive cents; null if a line is unreadable. */
export function splitRemaining(draft: Draft): number | null {
  const total = draftAmount(draft)
  if (total === null || draft.splits === null) return null
  let covered = 0
  for (const split of draft.splits) {
    if (!split.amount.trim()) continue
    const value = evaluateAmount(split.amount)
    if (value === null) return null
    covered += value
  }
  return Math.abs(total) - covered
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function resolveCategory(
  text: string,
  id: number | null,
  categories: CategoryOption[],
): number | null | undefined {
  if (id !== null) return id
  if (!text.trim()) return null
  return categories.find((row) => sameName(row.name, text))?.id
}

/** The transfer account a payee field names, by pick or by typing "Transfer: Savings". */
export function resolveTransferAccount(draft: Draft, accounts: Account[]): Account | null {
  if (draft.transferAccountId !== null) {
    return accounts.find((row) => row.id === draft.transferAccountId) ?? null
  }
  const text = draft.payeeText.trim()
  if (!text.toLowerCase().startsWith(TRANSFER_PREFIX.trim().toLowerCase())) return null
  const name = text.slice(TRANSFER_PREFIX.trim().length).trim()
  return accounts.find((row) => sameName(row.name, name)) ?? null
}

export function buildSave(draft: Draft, lookups: Lookups): BuildResult {
  const accountId =
    draft.accountId ??
    lookups.accounts.find((row) => sameName(row.name, draft.accountText))?.id ??
    null
  if (accountId === null) return { ok: false, field: 'account', message: 'Pick an account.' }

  const date = parseDateInput(draft.date, lookups.today)
  if (date === null) return { ok: false, field: 'date', message: 'That date is not valid.' }

  const amount = draftAmount(draft)
  if (amount === null) {
    const field =
      draft.outflow.trim() && evaluateAmount(draft.outflow) === null ? 'outflow' : 'inflow'
    return { ok: false, field, message: 'That amount is not a number.' }
  }
  if (amount === 0) return { ok: false, field: 'outflow', message: 'Enter an amount.' }

  const memo = draft.memo.trim() || null
  const sign = amount < 0 ? -1 : 1

  const transferAccount = resolveTransferAccount(draft, lookups.accounts)
  if (transferAccount !== null) {
    return buildTransfer(draft, lookups, { accountId, transferAccount, date, amount, memo })
  }

  let splits: SplitInput[]
  if (draft.splits !== null) {
    splits = []
    for (const [index, split] of draft.splits.entries()) {
      if (!split.amount.trim() && !split.categoryText.trim()) continue
      const value = evaluateAmount(split.amount)
      if (value === null || value === 0) {
        return { ok: false, field: `split-${index}-amount`, message: 'Each split needs an amount.' }
      }
      const categoryId = resolveCategory(split.categoryText, split.categoryId, lookups.categories)
      if (categoryId === undefined) {
        return {
          ok: false,
          field: `split-${index}-category`,
          message: 'Pick a category from the list.',
        }
      }
      splits.push({
        amount_cents: sign * value,
        category_id: categoryId,
        memo: split.memo.trim() || null,
      })
    }
    const remaining = splitRemaining(draft)
    if (remaining !== 0) {
      const last = Math.max(0, draft.splits.length - 1)
      return {
        ok: false,
        field: `split-${last}-amount`,
        message: 'The splits must add up to the whole amount.',
      }
    }
    if (splits.length === 0) {
      return { ok: false, field: 'split-0-amount', message: 'Add at least one split.' }
    }
  } else {
    const categoryId = resolveCategory(draft.categoryText, draft.categoryId, lookups.categories)
    if (categoryId === undefined) {
      return { ok: false, field: 'category', message: 'Pick a category from the list.' }
    }
    splits = [{ amount_cents: amount, category_id: categoryId }]
  }

  let payeeId = draft.payeeId
  let newPayeeName: string | null = null
  if (payeeId === null && draft.payeeText.trim()) {
    const existing = lookups.payees.find((row) => sameName(row.name, draft.payeeText))
    if (existing) payeeId = existing.id
    else newPayeeName = draft.payeeText.trim()
  }

  return {
    ok: true,
    plan: {
      kind: 'transaction',
      body: { account_id: accountId, date, amount_cents: amount, payee_id: payeeId, memo, splits },
      newPayeeName,
    },
  }
}

function buildTransfer(
  draft: Draft,
  lookups: Lookups,
  parts: {
    accountId: number
    transferAccount: Account
    date: string
    amount: number
    memo: string | null
  },
): BuildResult {
  const { accountId, transferAccount, date, amount, memo } = parts
  if (transferAccount.id === accountId) {
    return { ok: false, field: 'payee', message: 'A transfer needs two different accounts.' }
  }
  if (draft.splits !== null) {
    return { ok: false, field: 'category', message: 'A transfer cannot be split.' }
  }

  const here = lookups.accounts.find((row) => row.id === accountId)
  const categoryId = resolveCategory(draft.categoryText, draft.categoryId, lookups.categories)
  if (categoryId === undefined) {
    return { ok: false, field: 'category', message: 'Pick a category from the list.' }
  }

  // SPEC §6: only money crossing the budget boundary is categorised.
  const crossesBudget = (here?.on_budget ?? true) !== transferAccount.on_budget
  if (crossesBudget && categoryId === null) {
    return {
      ok: false,
      field: 'category',
      message: 'Money crossing into or out of the budget needs a category.',
    }
  }
  if (!crossesBudget && categoryId !== null) {
    return {
      ok: false,
      field: 'category',
      message: 'This transfer does not touch the budget, so it takes no category.',
    }
  }

  const outgoing = amount < 0
  return {
    ok: true,
    plan: {
      kind: 'transfer',
      body: {
        from_account_id: outgoing ? accountId : transferAccount.id,
        to_account_id: outgoing ? transferAccount.id : accountId,
        date,
        amount_cents: Math.abs(amount),
        category_id: categoryId,
        memo,
      },
    },
  }
}
