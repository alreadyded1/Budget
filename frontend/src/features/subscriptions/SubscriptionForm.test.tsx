// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SubscriptionForm } from './SubscriptionForm'
import { emptyForm } from './formState'

afterEach(cleanup)

function setup() {
  const onSave = vi.fn()
  const onCancel = vi.fn()
  render(
    <SubscriptionForm
      initial={emptyForm()}
      editing={false}
      accounts={[]}
      payees={[]}
      categories={[{ id: 11, name: 'Streaming', groupName: 'Bills' }]}
      busy={false}
      onSave={onSave}
      onCancel={onCancel}
    />,
  )
  return { onSave, onCancel, user: userEvent.setup() }
}

describe('SubscriptionForm', () => {
  it('tabs Name → Payee → Category → Amount → Repeats → First due', async () => {
    const { user } = setup()
    expect(document.activeElement).toBe(screen.getByLabelText('Name'))
    for (const label of ['Payee', 'Category', 'Amount', 'Repeats', 'First due']) {
      await user.tab()
      expect(document.activeElement).toBe(
        screen.getByLabelText(label, { selector: 'input,select' }),
      )
    }
  })

  it('shows the interval fields only for a custom schedule', async () => {
    const { user } = setup()
    expect(screen.queryByLabelText('Every')).toBeNull()
    await user.selectOptions(screen.getByLabelText('Repeats'), 'custom')
    expect(screen.getByLabelText('Every')).toBeTruthy()
  })

  it('Enter saves what was typed; Esc cancels', async () => {
    const { user, onSave, onCancel } = setup()
    await user.keyboard('Netflix')
    await user.tab()
    await user.tab()
    await user.keyboard('stream{Enter}') // picks the category, does not save
    expect(onSave).not.toHaveBeenCalled()
    await user.tab()
    await user.keyboard('15.99{Enter}')
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Netflix', categoryId: 11, amount: '15.99' }),
    )
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalled()
  })
})
