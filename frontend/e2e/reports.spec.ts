/** Phase 12: a spending report ties to its drill-down, exports CSV, and switches reports
 * with the filters kept — all without a page load.
 */

import { readFile } from 'node:fs/promises'

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const HEADERS = { 'X-PB-Request': '1' }

async function signIn(page: Page) {
  await page.goto('/login')
  await page.keyboard.type('e2e')
  await page.keyboard.press('Tab')
  await page.keyboard.type('e2e-password-123')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('link', { name: 'Reports' })).toBeVisible()
}

test('spending report, drill-down, CSV and income vs. expense', async ({ page }) => {
  await signIn(page)
  const request = page.request
  const post = async (path: string, data: unknown) => {
    const response = await request.post(`/api/v1${path}`, { data, headers: HEADERS })
    expect(response.ok(), `${path} → ${response.status()}`).toBeTruthy()
    return response.json()
  }
  const account = await post('/accounts', {
    name: 'Reports Checking',
    type: 'checking',
    opening_date: '2025-01-01',
  })
  const group = await post('/category-groups', { name: 'E2E Reports' })
  const fun = await post('/categories', { group_id: group.id, name: 'E2E Fun' })
  const books = await post('/categories', { group_id: group.id, name: 'E2E Books' })
  for (const [date, cents, category] of [
    ['2025-03-03', -2_500, fun],
    ['2025-03-10', -1_250, fun],
    ['2025-03-12', -4_000, books],
    ['2025-03-20', 300, fun], // a refund
  ] as const) {
    await post('/transactions', {
      account_id: account.id,
      date,
      amount_cents: cents,
      splits: [{ amount_cents: cents, category_id: category.id }],
    })
  }

  await page.goto(
    `/reports/spending?preset=custom&from=2025-03-01&to=2025-03-31&account=${account.id}`,
  )
  const documentLoads: string[] = []
  page.on('request', (req) => {
    if (req.resourceType() === 'document') documentLoads.push(req.url())
  })

  const table = page.getByTestId('spending-by-category-table')
  await expect(table).toContainText('E2E Fun')
  await expect(table.locator('tfoot')).toContainText('$74.50')
  await expect(page.getByTestId('report-range')).toHaveText('2025-03-01 to 2025-03-31')

  // CSV of what is on screen.
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('spending-by-category_2025-03-01_2025-03-31.csv')
  const text = await readFile((await file.path()) as string, 'utf-8')
  expect(text.split('\r\n').slice(0, 3)).toEqual([
    'Category,Group,Transactions,Spent,% of total',
    'E2E Books,E2E Reports,1,40.00,53.7',
    'E2E Fun,E2E Reports,3,34.50,46.3',
  ])

  // Drill down: the category's transactions add up to its total.
  await table.getByRole('link', { name: 'E2E Fun' }).click()
  await expect(page).toHaveURL(/\/reports\/transactions\?/)
  const list = page.getByTestId('transactions-table')
  await expect(list.locator('tbody tr')).toHaveCount(3)
  await expect(list.locator('tfoot')).toContainText('-$34.50')

  // Another report keeps the dates and filters, the drilled category included.
  await page.getByRole('link', { name: 'Income vs. expense' }).click()
  await expect(page.getByRole('button', { name: 'Categories: E2E Fun' })).toBeVisible()
  await expect(page.getByTestId('income-summary')).toContainText('Spending $34.50')
  await expect(page.getByTestId('report-range')).toHaveText('2025-03-01 to 2025-03-31')

  // Clearing the category brings the whole month back.
  await page.getByRole('button', { name: 'Categories: E2E Fun' }).click()
  await page.getByRole('button', { name: 'Clear' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('income-summary')).toContainText('Spending $74.50')
  await expect(page.getByTestId('income-summary')).toContainText('Net -$74.50')

  expect(documentLoads).toEqual([])
})
