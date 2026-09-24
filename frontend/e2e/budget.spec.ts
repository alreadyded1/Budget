/** Phase 6: editing a planned amount updates Remaining and the summary instantly, with
 * no page load, and the server agrees. Shares the throwaway server with the ledger test,
 * so its names are its own.
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
  await expect(page.getByRole('link', { name: 'Budget' })).toBeVisible()
}

async function call<T>(
  request: APIRequestContext,
  method: 'post' | 'patch',
  path: string,
  data: unknown,
) {
  const response = await request[method](`/api/v1${path}`, { data, headers: HEADERS })
  expect(response.ok(), `${path} → ${response.status()} ${await response.text()}`).toBeTruthy()
  return (await response.json()) as T
}

function iso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

test('planning a period from the keyboard', async ({ page }) => {
  await signIn(page)
  const request = page.request
  const today = new Date()
  const anchor = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 3)

  await call(request, 'post', '/pay-schedule', {
    frequency: 'biweekly',
    effective_from: iso(anchor),
    anchor_date: iso(anchor),
  })
  const account = await call<{ id: number }>(request, 'post', '/accounts', {
    name: 'Budget Checking',
    type: 'checking',
    opening_balance_cents: 200_000,
    opening_date: '2026-01-01',
  })
  const groups = (await (await request.get('/api/v1/category-groups')).json()) as {
    items: { name: string; categories: { id: number; name: string }[] }[]
  }
  const find = (name: string) =>
    groups.items.flatMap((group) => group.categories).find((category) => category.name === name)!
  const groceries = find('Groceries')
  const paycheck = find('Paycheck')
  await call(request, 'patch', `/categories/${groceries.id}`, { default_planned_cents: 40_000 })
  await call(request, 'patch', `/categories/${paycheck.id}`, { default_planned_cents: 250_000 })
  await call(request, 'post', '/transactions', {
    account_id: account.id,
    date: iso(today),
    amount_cents: -12_345,
    splits: [{ amount_cents: -12_345, category_id: groceries.id }],
  })
  await call(request, 'post', '/transactions', {
    account_id: account.id,
    date: iso(today),
    amount_cents: -500,
  })

  await page.goto('/budget')
  const plannedGroceries = page.getByLabel('Planned for Groceries')
  // A new period is prefilled from the template.
  await expect(plannedGroceries).toHaveValue('$400.00')
  await expect(page.getByTestId('remaining-Groceries')).toHaveText('$276.55')
  await expect(page.getByTestId('expected-income')).toHaveText('$2,500.00')

  const documentLoads: string[] = []
  page.on('request', (req) => {
    if (req.resourceType() === 'document') documentLoads.push(req.url())
  })
  await page.evaluate(() => {
    ;(window as unknown as { __pbMarker: string }).__pbMarker = 'still-here'
  })

  const plannedBefore = Number(
    (await page.getByTestId('planned-total').textContent())!.replace(/[$,]/g, ''),
  )

  // Edit Groceries from the keyboard: the totals move before the server answers.
  await plannedGroceries.focus()
  await expect(plannedGroceries).toHaveValue('400.00')
  let slowPut: () => void = () => {}
  const held = new Promise<void>((resolve) => (slowPut = resolve))
  await page.route(
    '**/api/v1/budget/*/categories/*',
    async (route) => {
      await held
      await route.continue()
    },
    { times: 1 },
  )
  await page.keyboard.type('150')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('remaining-Groceries')).toHaveText('$26.55')
  await expect(page.getByTestId('planned-total')).toHaveText(
    `$${(plannedBefore - 250).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
  )
  // Enter moved down to the next category in Food.
  await expect(page.getByLabel('Planned for Dining out')).toBeFocused()
  slowPut()

  // The server agrees.
  await expect
    .poll(async () => {
      const view = (await (await request.get('/api/v1/budget/current')).json()) as {
        expense: { lines: { name: string; planned_cents: number }[] }[]
      }
      return view.expense.flatMap((group) => group.lines).find((row) => row.name === 'Groceries')
        ?.planned_cents
    })
    .toBe(15_000)

  // Esc leaves the field; ] and [ walk the periods, t comes back.
  await page.keyboard.press('Escape')
  const label = page.getByTestId('period-label')
  const current = await label.textContent()
  await page.keyboard.press(']')
  await expect(label).not.toHaveText(current!)
  await expect(page.getByLabel('Planned for Groceries')).toHaveValue('$400.00') // next period: template
  await page.keyboard.press('t')
  await expect(label).toHaveText(current!)
  await expect(page.getByLabel('Planned for Groceries')).toHaveValue('$150.00')

  // The uncategorized alert opens the ledger already filtered.
  await expect(page.getByRole('alert')).toContainText('1 uncategorized transaction')
  await page.getByRole('link', { name: 'Review' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('scope-filter')).toContainText('Uncategorized only')
  await expect(page.getByTestId('ledger-row')).toHaveCount(1)

  expect(documentLoads).toEqual([])
  expect(await page.evaluate(() => (window as unknown as { __pbMarker?: string }).__pbMarker)).toBe(
    'still-here',
  )
})
