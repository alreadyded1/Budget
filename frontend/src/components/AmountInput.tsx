import type { ChangeEvent, KeyboardEvent, Ref } from 'react'

import { evaluateAmount, isExpression } from '../lib/amountExpr'

type Props = {
  value: string
  onChange: (value: string) => void
  inputRef?: Ref<HTMLInputElement>
  className?: string
  placeholder?: string
  'aria-label'?: string
  id?: string
  name?: string
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
  'data-plan-index'?: number
}

/** Cents as the text an amount field settles into: 1575 → "15.75". */
function settled(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const magnitude = Math.abs(cents)
  return `${sign}${Math.floor(magnitude / 100)}.${String(magnitude % 100).padStart(2, '0')}`
}

/** An amount field that takes `12.5`, `$1,234.56` or `12.50+3.25` (SPEC §7).
 *
 * An expression is worked out when the field loses focus, so the row shows the number
 * it will save. Anything unreadable stays as typed and is marked invalid.
 */
export function AmountInput({ value, onChange, inputRef, className = '', ...rest }: Props) {
  const cents = value.trim() ? evaluateAmount(value) : null
  const invalid = value.trim() !== '' && cents === null

  return (
    <input
      {...rest}
      ref={inputRef}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={value}
      aria-invalid={invalid || undefined}
      title={isExpression(value) && cents !== null ? `= ${settled(cents)}` : undefined}
      className={`${className} text-right tabular-nums ${invalid ? 'text-rose-600' : ''}`}
      onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={() => {
        if (cents !== null && isExpression(value)) onChange(settled(cents))
      }}
    />
  )
}
