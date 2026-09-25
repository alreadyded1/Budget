/** Phase 8: a subscription added from the keyboard shows on the calendar with paydays
 * marked, is paid from the ledger with the entry row prefilled, and appears in the
 * planner as a committed amount — all without a page load.
 */

import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'

const HEADERS = { 'X-PB-Request': '1' }

async function signIn(page: Page) {
  await page.goto('/login')
  await page.keyboard.type('e2e')
  await page.keyboard.press('Tab')
  await page.keyboard.type('e2e-password-123')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('link', { name: 'Bills & Recurring' })).toBeVisible()
}

function iso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

async function ensureSchedule(request: APIRequestContext) {
  const current = await request.get('/api/v1/pay-periods/current')
  if (current.ok()) return
  const today = new Date()
  const anchor = iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 3))
  const response = await request.post('/api/v1/pay-schedule', {
    data: { frequency: 'biweekly', effective_from: anchor, anchor_date: anchor },
    headers: HEADERS,
  })
  expect(response.ok()).toBeTruthy()
}

test('a bill from subscription to calendar to payment to plan', async ({ page }) => {
  await signIn(page)
  const request = page.request
  await ensureSchedule(request)
  const account = (await (
    await request.post('/api/v1/accounts', {
      data: { name: 'Bills Checking', type: 'checking', opening_date: '2026-01-01' },
      headers: HEADERS,
    })
  ).json()) as { id: number }
  const today = iso(new Date())
  const period = (await (await request.get('/api/v1/pay-periods/current')).json()) as {
    id: number
    start_date: string
  }

  await page.goto('/subscriptions')
  const documentLoads: string[] = []
  page.on('request', (req) => {
    if (req.resourceType() === 'document') documentLoads.push(req.url())
  })

  // Add it from the keyboard.
  await page.getByRole('button', { name: 'Add bill' }).focus()
  await page.keyboard.press('Enter')
  const form = page.getByTestId('subscription-form')
  await expect(form.getByLabel('Name')).toBeFocused()
  const keys = page.keyboard
  await keys.type('StreamCo')
  await keys.press('Tab')
  await keys.type('StreamCo') // a new payee, created on save
  await keys.press('Tab')
  await keys.type('Subscri')
  await keys.press('Tab') // picks "Subscriptions"
  await keys.type('12.99')
  await keys.press('Tab') // → Repeats (monthly)
  await keys.press('Tab') // → First due (today)
  await expect(form.getByLabel('First due')).toHaveValue(today)
  await keys.press('Tab') // → Ends
  await keys.press('Tab') // → Paid from
  await keys.type('Bills') // selects "Bills Checking"
  await keys.press('Enter')

  const row = page.getByTestId('subscription-StreamCo')
  await expect(row).toContainText(today)
  await expect(row).toContainText('$12.99')

  // The calendar shows it on today, with the payday marked.
  await page.getByRole('link', { name: 'Calendar' }).click()
  const chip = page.getByTestId(`bill-StreamCo-${today}`)
  await expect(chip).toHaveAttribute('data-status', 'upcoming')
  if (period.start_date.slice(0, 7) === today.slice(0, 7)) {
    await expect(page.getByTestId(`payday-${period.start_date}`)).toBeVisible()
  }

  // Mark paid: the ledger opens with the entry row filled in; Enter saves and links.
  await chip.focus()
  await keys.press('Enter')
  await expect(page.getByTestId('bill-detail')).toBeVisible()
  await keys.press('Enter') // "Mark paid" has focus
  await expect(page).toHaveURL(new RegExp(`/transactions/${account.id}\\?bill=\\d+`))
  await expect(page.getByTestId('paying-bill')).toContainText('StreamCo')
  const entry = page.getByTestId('entry-row')
  await expect(entry.getByRole('combobox', { name: 'Payee', exact: true })).toHaveValue('StreamCo')
  await expect(entry.getByRole('combobox', { name: 'Category', exact: true })).toHaveValue(
    'Subscriptions',
  )
  await expect(entry.getByLabel('Outflow')).toHaveValue('12.99')
  await entry.getByLabel('Memo').focus()
  await keys.press('Enter')
  await expect(page.getByText(`Marked StreamCo due ${today} paid.`)).toBeVisible()
  await expect(page.getByTestId('ledger-row')).toHaveCount(1)

  // The calendar now shows it paid.
  await page.getByRole('link', { name: 'Calendar' }).click()
  await expect(page.getByTestId(`bill-StreamCo-${today}`)).toHaveAttribute('data-status', 'paid')

  // The planner shows the committed amount for this period.
  await page.getByRole('link', { name: 'Budget' }).click()
  await expect(page.getByTestId('committed-Subscriptions')).toHaveText('$12.99 in bills')

  // Exactly one bill was paid, and the server agrees.
  const bills = (await (await request.get(`/api/v1/bills?from=${today}&to=2099-12-31`)).json()) as {
    items: { name: string; due_date: string; status: string }[]
  }
  expect(
    bills.items.filter((bill) => bill.name === 'StreamCo' && bill.status === 'paid'),
  ).toHaveLength(1)

  expect(documentLoads).toEqual([])
})
