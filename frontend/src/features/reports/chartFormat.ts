/** Categorical slots in fixed order (index.css). Colour follows the entity, never its rank. */
export const SERIES = [1, 2, 3, 4, 5, 6, 7, 8].map((slot) => `var(--series-${slot})`)

/** $1.2k style ticks; the tooltip and the table carry the exact cents. */
export function compactCents(cents: number): string {
  const dollars = cents / 100
  const magnitude = Math.abs(dollars)
  const sign = dollars < 0 ? '-' : ''
  if (magnitude >= 1_000_000) return `${sign}$${(magnitude / 1_000_000).toFixed(1)}M`
  if (magnitude >= 1_000)
    return `${sign}$${(magnitude / 1_000).toFixed(magnitude >= 10_000 ? 0 : 1)}k`
  return `${sign}$${magnitude.toFixed(0)}`
}
