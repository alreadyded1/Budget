// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { applyTheme, readOverride, resolveTheme, writeOverride } from './theme'

describe('resolveTheme', () => {
  it('prefers the browser, then the household, then the system', () => {
    expect(resolveTheme('light', 'dark', true)).toBe('light')
    expect(resolveTheme(null, 'dark', false)).toBe('dark')
    expect(resolveTheme(null, 'system', true)).toBe('dark')
    expect(resolveTheme(null, null, false)).toBe('light')
    expect(resolveTheme('system', 'light', true)).toBe('dark')
  })
})

describe('applyTheme and the override', () => {
  it('sets the class and colour scheme, and remembers the choice', () => {
    const root = document.createElement('html')
    applyTheme('dark', root)
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.style.colorScheme).toBe('dark')
    applyTheme('light', root)
    expect(root.classList.contains('dark')).toBe(false)

    writeOverride('dark')
    expect(readOverride()).toBe('dark')
    writeOverride(null)
    expect(readOverride()).toBeNull()
  })
})
