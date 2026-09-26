// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DateInput } from './DateInput'

const TODAY = '2026-09-25'

function Field({ start = '2026-01-31', onRowKey = vi.fn() }) {
  const [value, setValue] = useState(start)
  return (
    <div onKeyDown={(event) => onRowKey(event.key)}>
      <DateInput value={value} onChange={setValue} today={TODAY} aria-label="Date" />
      <output data-testid="value">{value}</output>
      <button type="button">elsewhere</button>
    </div>
  )
}

afterEach(cleanup)

const value = () => screen.getByTestId('value').textContent
const picker = () => screen.queryByRole('dialog', { name: 'Choose a date' })

describe('the date field calendar (repair list: it stayed open in Safari)', () => {
  it('closes as soon as a day is picked', async () => {
    const user = userEvent.setup()
    render(<Field />)
    await user.click(screen.getByRole('button', { name: 'Open calendar' }))
    expect(picker()).not.toBeNull()
    expect(screen.getByRole('grid', { name: 'January 2026' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '2026-01-14' }))
    expect(value()).toBe('2026-01-14')
    expect(picker()).toBeNull()
    expect(document.activeElement).toBe(screen.getByLabelText('Date'))
  })

  it('works from the keyboard, and its keys never reach the row', async () => {
    const onRowKey = vi.fn()
    const user = userEvent.setup()
    render(<Field onRowKey={onRowKey} />)
    screen.getByLabelText('Date').focus()
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '2026-01-31' }))
    onRowKey.mockClear()
    // Right a day into February, down a week, then pick.
    await user.keyboard('{ArrowRight}{ArrowDown}{Enter}')
    expect(value()).toBe('2026-02-08')
    expect(picker()).toBeNull()
    expect(onRowKey).not.toHaveBeenCalledWith('Enter')
    expect(onRowKey).not.toHaveBeenCalledWith('ArrowDown')
  })

  it('Page Down keeps the day or takes the month end', async () => {
    const user = userEvent.setup()
    render(<Field />)
    screen.getByLabelText('Date').focus()
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}{PageDown}{Enter}')
    expect(value()).toBe('2026-02-28')
  })

  it('Done and Esc close it without changing the date', async () => {
    const onRowKey = vi.fn()
    const user = userEvent.setup()
    render(<Field onRowKey={onRowKey} />)
    await user.click(screen.getByRole('button', { name: 'Open calendar' }))
    await user.click(screen.getByRole('button', { name: '✓ Done' }))
    expect(picker()).toBeNull()
    expect(value()).toBe('2026-01-31')

    await user.click(screen.getByRole('button', { name: 'Open calendar' }))
    onRowKey.mockClear()
    await user.keyboard('{Escape}')
    expect(picker()).toBeNull()
    expect(onRowKey).not.toHaveBeenCalledWith('Escape')
    expect(document.activeElement).toBe(screen.getByLabelText('Date'))
  })

  it('closes when focus goes elsewhere, and the button toggles it', async () => {
    const user = userEvent.setup()
    render(<Field />)
    const toggle = screen.getByRole('button', { name: 'Open calendar' })
    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: 'elsewhere' }))
    expect(picker()).toBeNull()

    await user.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    await user.click(toggle)
    expect(picker()).toBeNull()
  })

  it('changes month in Safari, where a clicked button gets no focus (repair)', async () => {
    render(<Field />)
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Open calendar' }))
    })
    const next = screen.getByRole('button', { name: 'Next month' })
    // Safari: mousedown on a button leaves focus nowhere, so the day button blurs to null.
    const pressed = fireEvent.mouseDown(next)
    expect(pressed).toBe(false) // default prevented: focus stays inside
    fireEvent.blur(screen.getByRole('button', { name: '2026-01-31' }), { relatedTarget: null })
    fireEvent.click(next)
    expect(picker()).not.toBeNull()
    expect(screen.getByRole('grid', { name: 'February 2026' })).toBeTruthy()
  })

  it('a click outside the field closes it, Tab away closes it', async () => {
    const user = userEvent.setup()
    render(<Field />)
    await user.click(screen.getByRole('button', { name: 'Open calendar' }))
    fireEvent.mouseDown(document.body)
    expect(picker()).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Open calendar' }))
    await user.tab() // day → Today
    await user.tab() // → Done
    expect(picker()).not.toBeNull()
    await user.tab() // → out of the calendar
    expect(picker()).toBeNull()
  })

  it('Today picks today, and an empty field opens on this month', async () => {
    const user = userEvent.setup()
    render(<Field start="" />)
    await user.click(screen.getByRole('button', { name: 'Open calendar' }))
    expect(screen.getByRole('grid', { name: 'September 2026' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Today' }))
    expect(value()).toBe(TODAY)
    expect(picker()).toBeNull()
  })

  it('the previous and next month buttons move the grid', async () => {
    render(<Field />)
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Open calendar' }))
    })
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByRole('grid', { name: 'February 2026' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(screen.getByRole('grid', { name: 'December 2025' })).toBeTruthy()
  })
})
