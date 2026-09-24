import { describe, expect, it } from 'vitest'

import type { Account } from '../../api/accounts'
import type { Payee } from '../../api/payees'
import type { Transaction } from '../../api/transactions'
import {
  buildSave,
  centsToInput,
  draftFromTransaction,
  emptyDraft,
  newSplit,
  splitRemaining,
} from './draft'
import type { Draft, Lookups } from './draft'

function account(id: number, name: string, onBudget = true): Account {
  return {
    id,
    name,
    type: onBudget ? 'checking' : 'loan',
    on_budget: onBudget,
    opening_balance_cents: 0,
    opening_date: '2026-01-01',
    institution: null,
    last4: null,
    sort_order: id,
    is_closed: false,
    valuation_mode: 'transactions',
    apr_bps: null,
    min_payment_cents: null,
    payment_due_day: null,
    low_balance_alert_cents: null,
    is_liability: !onBudget,
  }
}

const payee: Payee = {
  id: 7,
  name: 'Kroger',
  default_category_id: 11,
  notes: null,
  is_hidden: false,
  transaction_count: 1,
  last_used: null,
  total_spent_cents: 0,
  last_category_id: 11,
  last_amount_cents: -500,
}

const lookups: Lookups = {
  accounts: [account(1, 'Checking'), account(2, 'Savings'), account(3, 'Car Loan', false)],
  payees: [payee],
  categories: [
    { id: 11, name: 'Groceries', groupName: 'Food' },
    { id: 12, name: 'Dining', groupName: 'Food' },
  ],
  today: '2026-09-23',
}

function draft(overrides: Partial<Draft>): Draft {
  return { ...emptyDraft('t', lookups.accounts[0]), ...overrides }
}

describe('buildSave', () => {
  it('builds an outflow with one categorised split', () => {
    const result = buildSave(
      draft({ payeeText: 'kroger', categoryText: 'groceries', outflow: '12.50+3.25' }),
      lookups,
    )
    expect(result).toEqual({
      ok: true,
      plan: {
        kind: 'transaction',
        newPayeeName: null,
        body: {
          account_id: 1,
          date: '2026-09-23',
          amount_cents: -1575,
          payee_id: 7,
          memo: null,
          splits: [{ amount_cents: -1575, category_id: 11 }],
        },
      },
    })
  })

  it('reads an inflow as positive', () => {
    const result = buildSave(draft({ inflow: '100' }), lookups)
    expect(result.ok && result.plan.kind === 'transaction' && result.plan.body.amount_cents).toBe(
      10000,
    )
  })

  it('creates an unknown payee on save', () => {
    const result = buildSave(draft({ payeeText: '  Corner Shop ', outflow: '4' }), lookups)
    expect(result.ok && result.plan.kind === 'transaction' && result.plan.newPayeeName).toBe(
      'Corner Shop',
    )
  })

  it('points at the field that is wrong', () => {
    expect(buildSave(draft({ date: '2/30', outflow: '1' }), lookups)).toMatchObject({
      ok: false,
      field: 'date',
    })
    expect(buildSave(draft({ outflow: 'abc' }), lookups)).toMatchObject({ field: 'outflow' })
    expect(buildSave(draft({ inflow: '1+' }), lookups)).toMatchObject({ field: 'inflow' })
    expect(buildSave(draft({}), lookups)).toMatchObject({ field: 'outflow' })
    expect(buildSave(draft({ outflow: '1', categoryText: 'Nope' }), lookups)).toMatchObject({
      field: 'category',
    })
    expect(
      buildSave({ ...draft({ outflow: '1' }), accountId: null, accountText: '' }, lookups),
    ).toMatchObject({ field: 'account' })
  })

  it('finds the account by name in the All accounts view', () => {
    const result = buildSave(
      { ...draft({ outflow: '1' }), accountId: null, accountText: 'savings' },
      lookups,
    )
    expect(result.ok && result.plan.kind === 'transaction' && result.plan.body.account_id).toBe(2)
  })

  describe('splits', () => {
    it('signs each line like the whole and requires them to add up', () => {
      const lines = [
        { ...newSplit('30'), categoryId: 11, categoryText: 'Groceries' },
        { ...newSplit('10.00'), categoryText: 'dining' },
      ]
      const result = buildSave(draft({ outflow: '40', splits: lines }), lookups)
      expect(result.ok && result.plan.kind === 'transaction' && result.plan.body.splits).toEqual([
        { amount_cents: -3000, category_id: 11, memo: null },
        { amount_cents: -1000, category_id: 12, memo: null },
      ])
    })

    it('refuses splits that fall short', () => {
      const lines = [{ ...newSplit('30'), categoryId: 11 }, newSplit('')]
      expect(buildSave(draft({ outflow: '40', splits: lines }), lookups)).toMatchObject({
        ok: false,
        field: 'split-1-amount',
      })
    })

    it('ignores a blank trailing line', () => {
      const lines = [{ ...newSplit('40'), categoryId: 11 }, newSplit('')]
      expect(buildSave(draft({ outflow: '40', splits: lines }), lookups).ok).toBe(true)
    })

    it('tracks what is left to cover', () => {
      const lines = [newSplit('30'), newSplit('2.5')]
      expect(splitRemaining(draft({ outflow: '40', splits: lines }))).toBe(750)
      expect(splitRemaining(draft({ outflow: '40', splits: [newSplit('x')] }))).toBeNull()
    })
  })

  describe('transfers', () => {
    it('is recognised by typing the account in Payee', () => {
      const result = buildSave(draft({ payeeText: 'Transfer: savings', outflow: '250' }), lookups)
      expect(result).toEqual({
        ok: true,
        plan: {
          kind: 'transfer',
          body: {
            from_account_id: 1,
            to_account_id: 2,
            date: '2026-09-23',
            amount_cents: 25000,
            category_id: null,
            memo: null,
          },
        },
      })
    })

    it('runs the other way for an inflow', () => {
      const result = buildSave(draft({ transferAccountId: 2, inflow: '5' }), lookups)
      expect(result.ok && result.plan.kind === 'transfer' && result.plan.body).toMatchObject({
        from_account_id: 2,
        to_account_id: 1,
      })
    })

    it('needs a category only when it crosses the budget', () => {
      expect(buildSave(draft({ transferAccountId: 3, outflow: '300' }), lookups)).toMatchObject({
        ok: false,
        field: 'category',
      })
      expect(
        buildSave(draft({ transferAccountId: 2, outflow: '3', categoryId: 11 }), lookups),
      ).toMatchObject({ ok: false, field: 'category' })
      expect(
        buildSave(draft({ transferAccountId: 3, outflow: '300', categoryId: 11 }), lookups).ok,
      ).toBe(true)
    })

    it('cannot go to the same account', () => {
      expect(buildSave(draft({ transferAccountId: 1, outflow: '3' }), lookups)).toMatchObject({
        ok: false,
        field: 'payee',
      })
    })
  })
})

describe('draftFromTransaction', () => {
  const base: Transaction = {
    id: 1,
    account_id: 1,
    date: '2026-09-01',
    payee_id: 7,
    memo: 'milk',
    amount_cents: -1234,
    status: 'uncleared',
    check_number: null,
    transfer_id: null,
    transfer_account_id: null,
    splits: [{ id: 1, category_id: 11, amount_cents: -1234, memo: null, sort_order: 0 }],
  }

  it('opens a plain row with its names filled in', () => {
    expect(draftFromTransaction(base, lookups)).toMatchObject({
      date: '2026-09-01',
      payeeText: 'Kroger',
      categoryText: 'Groceries',
      memo: 'milk',
      outflow: '12.34',
      inflow: '',
      splits: null,
    })
  })

  it('opens a transfer leg as "Transfer: <account>"', () => {
    const leg = { ...base, payee_id: null, transfer_id: 'x', transfer_account_id: 2, splits: [] }
    expect(draftFromTransaction(leg, lookups)).toMatchObject({
      payeeText: 'Transfer: Savings',
      transferAccountId: 2,
    })
  })

  it('opens a split row with its lines', () => {
    const split = {
      ...base,
      splits: [
        { id: 1, category_id: 11, amount_cents: -1000, memo: null, sort_order: 0 },
        { id: 2, category_id: 12, amount_cents: -234, memo: 'tip', sort_order: 1 },
      ],
    }
    const opened = draftFromTransaction(split, lookups)
    expect(opened.splits?.map((line) => [line.categoryText, line.amount, line.memo])).toEqual([
      ['Groceries', '10.00', ''],
      ['Dining', '2.34', 'tip'],
    ])
  })
})

describe('centsToInput', () => {
  it('writes plain positive amounts', () => {
    expect(centsToInput(1234)).toBe('12.34')
    expect(centsToInput(-5)).toBe('0.05')
    expect(centsToInput(100000)).toBe('1000.00')
  })
})
