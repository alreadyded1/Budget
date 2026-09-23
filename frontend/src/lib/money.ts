/** Money is integer cents everywhere. Parsing and formatting happen only here, at the UI edge.
 *
 * The server half of this lives in app/domain/money.py (Phase 4); both round half away
 * from zero so 1.005 becomes 101 cents on either side.
 */

export function formatCents(cents: number, symbol = '$'): string {
  const negative = cents < 0
  const absolute = Math.abs(cents)
  const whole = Math.floor(absolute / 100)
  const remainder = absolute % 100
  const grouped = whole.toLocaleString(undefined, { useGrouping: true })
  const text = `${symbol}${grouped}.${String(remainder).padStart(2, '0')}`
  return negative ? `-${text}` : text
}

/** Rounds half away from zero, the way people expect money to round.
 *
 * `amount * 100` cannot be trusted on its own: 1.005 * 100 is 100.49999999999999 in
 * binary floating point, which would round down. Re-reading the product at 15
 * significant digits drops that error before rounding.
 */
export function roundToCents(amount: number): number {
  if (!Number.isFinite(amount)) return 0
  const scaled = Number((Math.abs(amount) * 100).toPrecision(15))
  return Math.sign(amount) * Math.round(scaled)
}

const AMOUNT = /^(-)?(\d*)(?:\.(\d*))?$/

/** Parses typed input into integer cents. Returns null when it isn't a number.
 *
 * The digits are read straight out of the string rather than through a float, so what
 * someone typed is what they get.
 */
export function parseAmountToCents(input: string): number | null {
  const cleaned = input.trim().replace(/[$,\s]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null

  const match = AMOUNT.exec(cleaned)
  if (match === null) return null

  const [, sign, whole = '', fraction = ''] = match
  if (whole === '' && fraction === '') return null

  const cents = Number(whole || '0') * 100 + Number(fraction.slice(0, 2).padEnd(2, '0') || '0')
  // A third decimal place of 5 or more rounds the cent away from zero.
  const rounded = fraction.length > 2 && fraction[2] >= '5' ? cents + 1 : cents
  return sign === '-' ? -rounded : rounded
}
