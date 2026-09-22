/** Turns the health endpoint's state into what the shell shows. */

export type HealthState = 'loading' | 'online' | 'degraded' | 'offline'

export function healthState(input: {
  isLoading: boolean
  isError: boolean
  status?: string
}): HealthState {
  if (input.isLoading) return 'loading'
  if (input.isError || !input.status) return 'offline'
  return input.status === 'ok' ? 'online' : 'degraded'
}

export function healthLabel(state: HealthState): string {
  switch (state) {
    case 'loading':
      return 'Checking API…'
    case 'online':
      return 'API online'
    case 'degraded':
      return 'API degraded'
    case 'offline':
      return 'API offline'
  }
}
