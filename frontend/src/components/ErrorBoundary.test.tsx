// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ErrorBoundary } from './ErrorBoundary'

function Boom(): never {
  throw new Error('kaboom')
}

afterEach(cleanup)

describe('ErrorBoundary', () => {
  it('shows a message instead of a blank page, and recovers on another page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { rerender } = render(
      <ErrorBoundary resetKey="/a">
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert').textContent).toContain('Something went wrong')
    expect(screen.getByText('kaboom')).toBeTruthy()
    rerender(
      <ErrorBoundary resetKey="/b">
        <p>fine</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('fine')).toBeTruthy()
  })
})
