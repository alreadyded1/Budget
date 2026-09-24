import { parseAmountToCents } from './money'

/** "19.99" → 1999 basis points. Two decimals, like cents, so the same parser reads it. */
export function parseApr(text: string): number | null | undefined {
  if (text.trim() === '') return null
  const bps = parseAmountToCents(text.replace('%', ''))
  return bps === null || bps < 0 ? undefined : bps
}
