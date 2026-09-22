/** Typed fetch wrapper. Every mutation carries X-PB-Request, the app's CSRF defence. */

export type ApiError = {
  status: number
  code: string
  detail: string
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export class ApiRequestError extends Error implements ApiError {
  status: number
  code: string
  detail: string

  constructor(status: number, code: string, detail: string) {
    super(detail)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
    this.detail = detail
  }
}

type RequestOptions = {
  method?: string
  body?: unknown
  signal?: AbortSignal
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = { Accept: 'application/json' }

  if (!SAFE_METHODS.has(method)) {
    headers['X-PB-Request'] = '1'
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  const response = await fetch(`/api/v1${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  })

  if (!response.ok) {
    const fallback = { detail: response.statusText, code: 'error' }
    const payload = (await response.json().catch(() => fallback)) as Partial<ApiError>
    throw new ApiRequestError(
      response.status,
      payload.code ?? fallback.code,
      payload.detail ?? fallback.detail,
    )
  }

  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}
