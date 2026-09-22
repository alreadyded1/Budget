/** Every TanStack Query key in one place so invalidation stays predictable. */

export const queryKeys = {
  health: ['health'] as const,
  session: ['session'] as const,
  users: ['users'] as const,
  settings: ['settings'] as const,
}
