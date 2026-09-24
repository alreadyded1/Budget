/** Phase 5's "Done when": ten transactions — three payees (one new), a split and a
 * transfer — entered from the keyboard alone, with no document navigation, instant
 * balances, and a forced server error that rolls back and refills the entry row.
 */

import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'

const USER = 'e2e'
const PASSWORD = 'e2e-password-123'
const HEADERS = { 'X-PB-Request': '1' }

type Category = { id: number; name: string }

async function signIn(page: Page) {
  await page.goto('/login')
  await page.keyboard.type(USER)
  await page.keyboard.press('Tab')
  await page.keyboard.type(PASSWORD)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('link', { name: 'Transactions' })).toBeVisible()
}

async function post<T>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await request.post(`/api/v1${path}`, { data, headers: HEADERS })
  expect(response.ok(), `${path} → ${response.status()}`).toBeTruthy()
  return (await response.json()) as T
}

async function categoryByName(request: APIRequestContext, name: string): Promise<Category> {
  const groups = (await (await request.get('/api/v1/category-groups')).json()) as {
    items: { categories: Category[] }[]
  }
  const found = groups.items.flatMap((group) => group.categories).find((row) => row.name === name)
  if (!found) throw new Error(`no category ${name}`)
  return found
}

function money(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const magnitude = Math.abs(cents)
  const whole = Math.floor(magnitude / 100).toLocaleString('en-US')
  return `${sign}$${whole}.${String(magnitude % 100).padStart(2, '0')}`
}

test('ten transactions from the keyboard, with no page loads', async ({ page }) => {
  await signIn(page)
  const request = page.request

  const checking = await post<{ id: number }>(request, '/accounts', {
    name: 'Checking',
    type: 'checking',
    opening_balance_cents: 100_000,
    opening_date: '2026-01-01',
  })
  const savings = await post<{ id: number }>(request, '/accounts', {
    name: 'Savings',
    type: 'savings',
    opening_balance_cents: 0,
    opening_date: '2026-01-01',
  })
  const groceries = await categoryByName(request, 'Groceries')
  await post(request, '/payees', { name: 'Kroger', default_category_id: groceries.id })
  await post(request, '/payees', { name: 'Target' })

  await page.goto(`/transactions/${checking.id}`)
  await expect(page.getByTestId('entry-row')).toBeVisible()

  // From here on: no document loads, only fetch/XHR.
  const documentLoads: string[] = []
  const otherRequests: string[] = []
  page.on('request', (req) => {
    const type = req.resourceType()
    if (type === 'document') documentLoads.push(req.url())
    else if (type !== 'fetch' && type !== 'xhr') otherRequests.push(`${type} ${req.url()}`)
  })
  await page.evaluate(() => {
    ;(window as unknown as { __pbMarker: string }).__pbMarker = 'still-here'
  })

  const entry = page.getByTestId('entry-row')
  const payee = entry.getByRole('combobox', { name: 'Payee', exact: true })
  const rows = page.getByTestId('ledger-row')
  const balance = page.getByTestId('account-balance')
  const keys = page.keyboard

  // n focuses the entry row, starting at Date.
  await page.locator('body').press('n')
  await expect(entry.getByLabel('Date')).toBeFocused()
  await keys.type('9/1')
  await keys.press('Tab')

  let expected = 100_000

  // 1. Existing payee picked with Tab; its pinned category fills in.
  await keys.type('Kro')
  await keys.press('Tab')
  await expect(entry.getByRole('combobox', { name: 'Category', exact: true })).toHaveValue(
    'Groceries',
  )
  await keys.press('Tab') // category → memo
  await keys.type('weekly shop')
  await keys.press('Tab') // memo → outflow
  await keys.type('45.20')
  await keys.press('Enter')
  expected -= 4520
  await expect(rows).toHaveCount(1)
  await expect(balance).toHaveText(money(expected))
  // The row clears, keeps the date, and focus is back on Payee.
  await expect(payee).toBeFocused()
  await expect(payee).toHaveValue('')
  await expect(entry.getByLabel('Date')).toHaveValue('2026-09-01')

  // 2. Second existing payee, category by typing, amount by arithmetic.
  await keys.type('Targ')
  await keys.press('Tab')
  await keys.type('Cloth')
  await keys.press('Tab')
  await keys.press('Tab') // memo
  await keys.type('12.50+3.25')
  await keys.press('Enter')
  expected -= 1575
  await expect(rows).toHaveCount(2)

  // 3. A brand-new payee, created when the row saves.
  await keys.type('Corner Bakery')
  await keys.press('Tab') // picks "Create 'Corner Bakery'"
  await keys.type('Dining')
  await keys.press('Tab')
  await keys.press('Tab')
  await keys.type('8.75')
  // Step 4 reads the payee's last category, which the cache learns when the server confirms
  // the save; the optimistic row alone is not enough (see PROGRESS parking lot).
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/transactions') && response.request().method() === 'POST',
  )
  await keys.press('Enter')
  await saved
  expected -= 875
  await expect(rows).toHaveCount(3)
  await expect(rows.first()).toContainText('Corner Bakery')

  // 4. The new payee again: its category now comes from last use.
  await keys.type('corner')
  await keys.press('Tab')
  await expect(entry.getByRole('combobox', { name: 'Category', exact: true })).toHaveValue(
    'Dining out',
  )
  await keys.press('Tab')
  await keys.press('Tab')
  await keys.type('20')
  await keys.press('Enter')
  expected -= 2000
  await expect(rows).toHaveCount(4)

  // 5. A split: Groceries 40.00 and Clothing 20.00 out of 60.00.
  await keys.type('Target')
  await keys.press('Tab')
  await keys.type('split')
  await keys.press('Tab') // picks "Split…", on to Memo
  await keys.press('Tab') // memo → outflow
  await keys.type('60')
  await keys.press('Tab') // outflow → inflow
  await keys.press('Tab') // inflow → split 1 category
  await keys.type('Groc')
  await keys.press('Tab')
  await keys.press('Tab') // split memo → split amount
  await keys.type('40')
  await keys.press('Tab') // 20.00 left over starts line 2
  await expect(entry.getByLabel('Split 2 amount')).toHaveValue('20.00')
  await keys.type('Cloth')
  await keys.press('Tab')
  await expect(page.getByTestId('split-remaining')).toHaveText('Splits add up')
  await keys.press('Enter')
  expected -= 6000
  await expect(rows).toHaveCount(5)
  await expect(rows.first()).toContainText('Split (2)')

  // 6. A transfer, chosen by typing the account name in Payee.
  await keys.type('Sav')
  await keys.press('Tab')
  await expect(payee).toHaveValue('Transfer: Savings')
  // Focus is on Category, which stays empty between two on-budget accounts.
  await keys.press('Tab') // → memo
  await keys.type('to savings')
  await keys.press('Tab')
  await keys.type('200')
  await keys.press('Enter')
  expected -= 20000
  await expect(rows).toHaveCount(6)
  await expect(rows.first()).toContainText('Transfer: Savings')

  // 7. A refund: a leading + in Outflow moves the amount to Inflow.
  await keys.type('Kroger')
  await keys.press('Tab')
  await keys.press('Tab')
  await keys.type('refund')
  await keys.press('Tab')
  await keys.type('+5')
  await expect(entry.getByLabel('Inflow')).toBeFocused()
  await expect(entry.getByLabel('Inflow')).toHaveValue('5')
  await keys.press('Enter')
  expected += 500
  await expect(rows).toHaveCount(7)

  // 8–10. A new date with the + shortcut, then three quick ones.
  await keys.press('Shift+Tab') // payee → date
  await keys.press('+')
  await expect(entry.getByLabel('Date')).toHaveValue('2026-09-02')
  await keys.press('Tab')
  for (const [name, amount] of [
    ['Kroger', 1234],
    ['Target', 321],
    ['Corner Bakery', 450],
  ] as const) {
    await keys.type(name)
    await keys.press('Tab')
    await keys.press('Tab')
    await keys.press('Tab')
    await keys.type((amount / 100).toFixed(2))
    await keys.press('Enter')
    expected -= amount
  }
  await expect(rows).toHaveCount(10)
  await expect(balance).toHaveText(money(expected))

  // The server agrees with what the screen showed.
  const server = (await (await request.get('/api/v1/balances')).json()) as {
    items: { account_id: number; current_cents: number }[]
  }
  const byId = new Map(server.items.map((row) => [row.account_id, row.current_cents]))
  expect(byId.get(checking.id)).toBe(expected)
  expect(byId.get(savings.id)).toBe(20000)
  const payees = (await (await request.get('/api/v1/payees')).json()) as {
    items: { name: string }[]
  }
  expect(payees.items.map((row) => row.name).sort()).toEqual(['Corner Bakery', 'Kroger', 'Target'])
  // Newest first; the running balance on top equals the account balance.
  await expect(rows.first()).toContainText(money(expected))

  // A forced server error rolls the row back and refills the entry row.
  await page.route('**/api/v1/transactions', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Forced failure for the test.', code: 'boom' }),
        })
      : route.continue(),
  )
  await keys.type('Kroger')
  await keys.press('Tab')
  await keys.press('Tab')
  await keys.type('will fail')
  await keys.press('Tab')
  await keys.type('99.99')
  await keys.press('Enter')
  await expect(page.getByText('Forced failure for the test.')).toBeVisible()
  await expect(rows).toHaveCount(10)
  await expect(balance).toHaveText(money(expected))
  await expect(payee).toHaveValue('Kroger')
  await expect(entry.getByLabel('Memo')).toHaveValue('will fail')
  await expect(entry.getByLabel('Outflow')).toHaveValue('99.99')

  // Esc clears the row; a second Esc on an empty row steps out of it.
  await page.unroute('**/api/v1/transactions')
  await keys.press('Escape')
  await expect(payee).toHaveValue('')
  await keys.press('Escape')

  // Row shortcuts: select, toggle cleared, edit inline, delete, undo.
  await keys.press('j')
  await expect(rows.first()).toHaveAttribute('aria-selected', 'true')
  await keys.press('c')
  await expect(rows.first().getByRole('button', { name: 'Status: cleared' })).toBeVisible()
  await keys.press('Enter')
  const editor = page.getByTestId('edit-row')
  await expect(editor).toBeVisible()
  await keys.press('Tab') // payee → category
  await keys.press('Tab') // → memo
  await keys.type('edited')
  await keys.press('Enter')
  await expect(editor).toHaveCount(0)
  await expect(rows.first()).toContainText('edited')
  await keys.press('Delete')
  await expect(rows).toHaveCount(9)
  await expect(balance).toHaveText(money(expected + 450))
  await keys.press('u')
  await expect(rows).toHaveCount(10)
  await expect(balance).toHaveText(money(expected))

  // ? shows the shortcut list; Esc closes it.
  await keys.press('?')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
  await keys.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0)

  // Nothing reloaded the page at any point.
  expect(documentLoads).toEqual([])
  expect(otherRequests).toEqual([])
  expect(await page.evaluate(() => (window as unknown as { __pbMarker?: string }).__pbMarker)).toBe(
    'still-here',
  )
  expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(1)
})
