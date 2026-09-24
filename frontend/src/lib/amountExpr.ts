/** The amount fields' arithmetic: `12.50+3.25`, `100/3`, `$1,234.56 - 20` (SPEC §7).
 *
 * Every number is held as an exact fraction of BigInts, so `0.1+0.2` is 30 cents and
 * `100/3` is 3333 cents, not whatever binary floating point makes of them. Rounding to
 * cents happens once, at the end, half away from zero — the same rule as money.ts.
 */

type Fraction = { n: bigint; d: bigint }

type Token = { kind: 'num'; value: Fraction } | { kind: 'op'; value: string }

const NUMBER = /^(\d+(?:\.\d*)?|\.\d+)/

function fraction(n: bigint, d: bigint): Fraction {
  return d < 0n ? { n: -n, d: -d } : { n, d }
}

function readNumber(text: string): Fraction {
  const [whole, decimals = ''] = text.split('.')
  const scale = 10n ** BigInt(decimals.length)
  return fraction(BigInt(whole || '0') * scale + BigInt(decimals || '0'), scale)
}

function tokenize(input: string): Token[] | null {
  // Currency symbols, thousands separators and spaces are noise here.
  let text = input.replace(/[$,\s]/g, '')
  const tokens: Token[] = []
  while (text.length > 0) {
    const number = NUMBER.exec(text)
    if (number !== null) {
      tokens.push({ kind: 'num', value: readNumber(number[1]) })
      text = text.slice(number[1].length)
      continue
    }
    const char = text[0]
    if ('+-*/()x×÷'.includes(char)) {
      const op = char === 'x' || char === '×' ? '*' : char === '÷' ? '/' : char
      tokens.push({ kind: 'op', value: op })
      text = text.slice(1)
      continue
    }
    return null
  }
  return tokens
}

class Parser {
  private index = 0
  private readonly tokens: Token[]

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  parse(): Fraction | null {
    const value = this.expression()
    return value !== null && this.index === this.tokens.length ? value : null
  }

  private peekOp(): string | null {
    const token = this.tokens[this.index]
    return token?.kind === 'op' ? token.value : null
  }

  private expression(): Fraction | null {
    let left = this.term()
    while (left !== null && (this.peekOp() === '+' || this.peekOp() === '-')) {
      const op = this.peekOp()
      this.index++
      const right = this.term()
      if (right === null) return null
      left =
        op === '+'
          ? fraction(left.n * right.d + right.n * left.d, left.d * right.d)
          : fraction(left.n * right.d - right.n * left.d, left.d * right.d)
    }
    return left
  }

  private term(): Fraction | null {
    let left = this.unary()
    while (left !== null && (this.peekOp() === '*' || this.peekOp() === '/')) {
      const op = this.peekOp()
      this.index++
      const right = this.unary()
      if (right === null) return null
      if (op === '*') {
        left = fraction(left.n * right.n, left.d * right.d)
      } else {
        if (right.n === 0n) return null
        left = fraction(left.n * right.d, left.d * right.n)
      }
    }
    return left
  }

  private unary(): Fraction | null {
    const op = this.peekOp()
    if (op === '-' || op === '+') {
      this.index++
      const value = this.unary()
      if (value === null) return null
      return op === '-' ? fraction(-value.n, value.d) : value
    }
    return this.primary()
  }

  private primary(): Fraction | null {
    const token = this.tokens[this.index]
    if (token === undefined) return null
    if (token.kind === 'num') {
      this.index++
      return token.value
    }
    if (token.value === '(') {
      this.index++
      const value = this.expression()
      if (value === null || this.peekOp() !== ')') return null
      this.index++
      return value
    }
    return null
  }
}

/** Rounds n/d dollars to whole cents, half away from zero. */
function toCents({ n, d }: Fraction): number {
  const scaled = n * 100n
  const negative = scaled < 0n
  const magnitude = negative ? -scaled : scaled
  const quotient = magnitude / d
  const remainder = magnitude % d
  const rounded = remainder * 2n >= d ? quotient + 1n : quotient
  const cents = Number(negative ? -rounded : rounded)
  return cents === 0 ? 0 : cents // no negative zero
}

/** Evaluates an amount field into integer cents. Null when it is empty or not arithmetic. */
export function evaluateAmount(input: string): number | null {
  const tokens = tokenize(input.trim())
  if (tokens === null || tokens.length === 0) return null
  const value = new Parser(tokens).parse()
  return value === null ? null : toCents(value)
}

/** Whether a field holds an expression rather than a plain number, e.g. to show its result. */
export function isExpression(input: string): boolean {
  return /\d\s*[-+*/x×÷]/.test(input.replace(/[$,]/g, ''))
}
