/** The subscription form's state, and how it becomes an API body. No React here. */

import type { Payee } from '../../api/payees'
import type {
  Frequency,
  IntervalUnit,
  Subscription,
  SubscriptionInput,
} from '../../api/subscriptions'
import { evaluateAmount } from '../../lib/amountExpr'
import { parseDateInput, todayIso } from '../../lib/dates'
import { centsToInput } from '../ledger/draft'
import type { CategoryOption } from '../ledger/draft'

export type FormState = {
  name: string
  payeeText: string
  payeeId: number | null
  categoryText: string
  categoryId: number | null
  accountId: string
  amount: string
  frequency: Frequency
  intervalCount: string
  intervalUnit: IntervalUnit
  anchor: string
  end: string
  autoPost: boolean
  remindDays: string
  url: string
  notes: string
}

export function emptyForm(): FormState {
  return {
    name: '',
    payeeText: '',
    payeeId: null,
    categoryText: '',
    categoryId: null,
    accountId: '',
    amount: '',
    frequency: 'monthly',
    intervalCount: '1',
    intervalUnit: 'month',
    anchor: todayIso(),
    end: '',
    autoPost: false,
    remindDays: '3',
    url: '',
    notes: '',
  }
}

export function formFrom(
  sub: Subscription,
  payees: Payee[],
  categories: CategoryOption[],
): FormState {
  return {
    name: sub.name,
    payeeText: payees.find((payee) => payee.id === sub.payee_id)?.name ?? '',
    payeeId: sub.payee_id,
    categoryText: categories.find((category) => category.id === sub.category_id)?.name ?? '',
    categoryId: sub.category_id,
    accountId: sub.account_id === null ? '' : String(sub.account_id),
    amount: centsToInput(sub.amount_cents),
    frequency: sub.frequency,
    intervalCount: String(sub.interval_count),
    intervalUnit: sub.interval_unit ?? 'month',
    anchor: sub.next_due_date ?? sub.anchor_date,
    end: sub.end_date ?? '',
    autoPost: sub.auto_post,
    remindDays: String(sub.remind_days_before),
    url: sub.url ?? '',
    notes: sub.notes ?? '',
  }
}

export type BuiltForm =
  | { ok: true; body: SubscriptionInput; newPayeeName: string | null }
  | { ok: false; message: string }

/** Turns the form into an API body, or says what is missing. */
export function buildForm(
  form: FormState,
  payees: Payee[],
  categories: CategoryOption[],
): BuiltForm {
  const today = todayIso()
  if (!form.name.trim()) return { ok: false, message: 'Give it a name.' }
  const amount = evaluateAmount(form.amount)
  if (amount === null || amount <= 0) return { ok: false, message: 'Enter an amount above zero.' }
  const anchor = parseDateInput(form.anchor, today)
  if (anchor === null) return { ok: false, message: 'The due date is not valid.' }
  const end = form.end.trim() ? parseDateInput(form.end, today) : null
  if (form.end.trim() && end === null) return { ok: false, message: 'The end date is not valid.' }
  const count = Number(form.intervalCount)
  if (form.frequency === 'custom' && !(Number.isInteger(count) && count >= 1)) {
    return { ok: false, message: 'Repeat every 1 or more.' }
  }
  const remind = Number(form.remindDays)
  if (!(Number.isInteger(remind) && remind >= 0 && remind <= 60)) {
    return { ok: false, message: 'Reminders are 0 to 60 days ahead.' }
  }

  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
  let payeeId = form.payeeId
  let newPayeeName: string | null = null
  if (payeeId === null && form.payeeText.trim()) {
    const existing = payees.find((payee) => same(payee.name, form.payeeText))
    if (existing) payeeId = existing.id
    else newPayeeName = form.payeeText.trim()
  }
  let categoryId = form.categoryId
  if (categoryId === null && form.categoryText.trim()) {
    const found = categories.find((category) => same(category.name, form.categoryText))
    if (!found) return { ok: false, message: 'Pick a category from the list.' }
    categoryId = found.id
  }

  return {
    ok: true,
    newPayeeName,
    body: {
      name: form.name.trim(),
      payee_id: payeeId,
      category_id: categoryId,
      account_id: form.accountId ? Number(form.accountId) : null,
      amount_cents: amount,
      frequency: form.frequency,
      interval_count: form.frequency === 'custom' ? count : 1,
      interval_unit: form.frequency === 'custom' ? form.intervalUnit : null,
      anchor_date: anchor,
      end_date: end,
      status: 'active',
      auto_post: form.autoPost,
      remind_days_before: remind,
      url: form.url.trim() || null,
      notes: form.notes.trim() || null,
    },
  }
}
