import { describe, expect, it } from 'vitest'

import { healthLabel, healthState } from './health'

describe('healthState', () => {
  it('reports loading before the first response', () => {
    expect(healthState({ isLoading: true, isError: false })).toBe('loading')
  })

  it('reports online when the API says ok', () => {
    expect(healthState({ isLoading: false, isError: false, status: 'ok' })).toBe('online')
  })

  it('reports degraded when the API answers but the database does not', () => {
    expect(healthState({ isLoading: false, isError: false, status: 'degraded' })).toBe('degraded')
  })

  it('reports offline when the request fails', () => {
    expect(healthState({ isLoading: false, isError: true })).toBe('offline')
  })
})

describe('healthLabel', () => {
  it('gives every state a label', () => {
    expect(healthLabel('online')).toBe('API online')
    expect(healthLabel('offline')).toBe('API offline')
  })
})
