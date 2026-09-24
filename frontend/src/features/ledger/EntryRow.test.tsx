// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Account } from '../../api/accounts'
import type { Payee } from '../../api/payees'
import { EntryRow } from './EntryRow'
import { emptyDraft } from './draft'
import type { Draft, Lookups } from './draft'

afterEach(cleanup)

function account(id: number, name: string): Account {
  return {
    id,
    name,
    type: 'checking',
    on_budget: true,
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
    is_liability: false,
  }
}

function payee(id: number, name: string, extra: Partial<Payee> = {}): Payee {
  return {
    id,
    name,
    default_category_id: null,
    notes: null,
    is_hidden: false,
    transaction_count: 0,
    last_used: null,
    total_spent_cents: 0,
    last_category_id: null,
    last_amount_cents: null,
    ...extra,
  }
}

const checking = account(1, 'Checking')
const lookups: Lookups = {
  accounts: [checking, account(2, 'Savings')],
  payees: [
    payee(7, 'Kroger', { default_category_id: 11 }),
    payee(8, 'Target', { last_amount_cents: -2599, last_category_id: 12 }),
  ],
  categories: [
    { id: 11, name: 'Groceries', groupName: 'Food' },
    { id: 12, name: 'Clothing', groupName: 'Personal' },
  ],
  today: '2026-09-23',
}

type HarnessProps = {
  fixed?: Account | null
  prefill?: boolean
  onSave?: (draft: Draft) => void
  onCancel?: () => void
}

function Harness({
  fixed = checking,
  prefill = false,
  onSave = () => {},
  onCancel = () => {},
}: HarnessProps) {
  const [draft, setDraft] = useState<Draft>(() => emptyDraft('2026-09-23', fixed))
  return (
    <EntryRow
      mode="new"
      draft={draft}
      setDraft={setDraft}
      lookups={lookups}
      fixedAccount={fixed}
      prefillLastAmount={prefill}
      onSave={() => onSave(draft)}
      onCancel={onCancel}
    />
  )
}

const field = (name: string) =>
  screen.getByLabelText(name, { selector: 'input' }) as HTMLInputElement
const combo = (name: string) => screen.getByRole('combobox', { name }) as HTMLInputElement

describe('EntryRow tab order', () => {
  it('runs Date → Payee → Category → Memo → Outflow → Inflow, and back with Shift+Tab', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    field('Date').focus()

    const order = ['Payee', 'Category', 'Memo', 'Outflow', 'Inflow']
    for (const name of order) {
      await user.tab()
      expect(document.activeElement).toBe(field(name))
    }
    for (const name of [...order].reverse().slice(1)) {
      await user.tab({ shift: true })
      expect(document.activeElement).toBe(field(name))
    }
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(field('Date'))
  })

  it('starts with Account in the All accounts view', async () => {
    const user = userEvent.setup()
    render(<Harness fixed={null} />)
    combo('Account').focus()
    await user.tab()
    expect(document.activeElement).toBe(field('Date'))
  })
})

describe('EntryRow keys', () => {
  it('Tab picks the highlighted payee and fills in its pinned category', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    combo('Payee').focus()
    await user.keyboard('kro')
    await user.tab()
    expect(combo('Payee').value).toBe('Kroger')
    expect(combo('Category').value).toBe('Groceries')
    expect(document.activeElement).toBe(combo('Category'))
  })

  it('falls back to the last category used, and the last amount when that is on', async () => {
    const user = userEvent.setup()
    render(<Harness prefill />)
    combo('Payee').focus()
    await user.keyboard('targ')
    await user.tab()
    expect(combo('Category').value).toBe('Clothing')
    expect(field('Outflow').value).toBe('25.99')
  })

  it('Enter with the list open picks; Enter again saves', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<Harness onSave={onSave} />)
    combo('Payee').focus()
    await user.keyboard('targ{Enter}')
    expect(onSave).not.toHaveBeenCalled()
    expect(combo('Payee').value).toBe('Target')
    await user.keyboard('{Enter}')
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('Enter saves from any field', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<Harness onSave={onSave} />)
    field('Memo').focus()
    await user.keyboard('milk{Enter}')
    field('Inflow').focus()
    await user.keyboard('{Enter}')
    expect(onSave).toHaveBeenCalledTimes(2)
  })

  it('offers to create a payee that does not exist', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    combo('Payee').focus()
    await user.keyboard('Corner Bakery')
    expect(screen.getByRole('option', { name: "Create 'Corner Bakery'" })).toBeTruthy()
  })

  it('Esc closes the list first and reaches the row second', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<Harness onCancel={onCancel} />)
    combo('Payee').focus()
    await user.keyboard('kro')
    expect(screen.queryByRole('listbox')).not.toBeNull()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onCancel).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('a leading + in Outflow moves the amount to Inflow', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    field('Outflow').focus()
    await user.keyboard('+12')
    expect(document.activeElement).toBe(field('Inflow'))
    expect(field('Inflow').value).toBe('12')
    expect(field('Outflow').value).toBe('')
  })

  it('typing in one amount field clears the other', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    field('Outflow').focus()
    await user.keyboard('5')
    field('Inflow').focus()
    await user.keyboard('7')
    expect(field('Outflow').value).toBe('')
    field('Outflow').focus()
    await user.keyboard('3')
    expect(field('Inflow').value).toBe('')
  })

  it('works out amount math when the field is left', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    field('Outflow').focus()
    await user.keyboard('12.50+3.25')
    await user.tab()
    expect(field('Outflow').value).toBe('15.75')
  })

  it('opens split lines with a live remaining amount', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    field('Outflow').focus()
    await user.keyboard('60')
    combo('Category').focus()
    await user.keyboard('spl')
    await user.tab()
    expect(combo('Category').value).toBe('Split…')
    expect(screen.getByTestId('split-remaining').textContent).toBe('Remaining $60.00')

    field('Split 1 amount').focus()
    await user.keyboard('40')
    expect(screen.getByTestId('split-remaining').textContent).toBe('Remaining $20.00')
    await user.tab()
    // Leaving the last line with money left over starts a new line holding it.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(field('Split 2 amount').value).toBe('20.00')
    expect(document.activeElement).toBe(combo('Split 2 category'))
    expect(screen.getByTestId('split-remaining').textContent).toBe('Splits add up')
  })
})

describe('DateInput shortcuts in the row', () => {
  it('t, + and - move the date; a short date settles on blur', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const date = field('Date')
    date.focus()
    await user.keyboard('+')
    expect(date.value).toBe('2026-09-24')
    await user.keyboard('--')
    expect(date.value).toBe('2026-09-22')
    await user.keyboard('t')
    expect(date.value).toBe('2026-09-23')
    await user.keyboard('3/15')
    await user.tab()
    expect(date.value).toBe('2026-03-15')
  })
})
