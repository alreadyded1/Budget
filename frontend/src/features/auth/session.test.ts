import { describe, expect, it } from 'vitest'

import { ApiRequestError } from '../../api/client'
import { isUnauthenticated } from './useSession'

describe('isUnauthenticated', () => {
  it('recognises a 401 from the API', () => {
    expect(isUnauthenticated(new ApiRequestError(401, 'unauthenticated', 'Not signed in.'))).toBe(
      true,
    )
  })

  it('treats a session expiry as unauthenticated too', () => {
    expect(
      isUnauthenticated(new ApiRequestError(401, 'session_expired', 'Your session has expired.')),
    ).toBe(true)
  })

  it('does not treat other API errors as a missing session', () => {
    expect(isUnauthenticated(new ApiRequestError(403, 'missing_request_header', 'Nope.'))).toBe(
      false,
    )
    expect(isUnauthenticated(new ApiRequestError(500, 'internal_error', 'Boom.'))).toBe(false)
  })

  it('ignores errors that did not come from the API client', () => {
    expect(isUnauthenticated(new Error('network down'))).toBe(false)
    expect(isUnauthenticated(null)).toBe(false)
  })
})
