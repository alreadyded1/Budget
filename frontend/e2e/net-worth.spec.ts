/** Phase 14: a debt missing its APR is fixed from the Accounts page and joins the payoff plan;
 * a house valued by hand shows in net worth — all without a page load.
 */

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const HEADERS = { 'X-PB-Request': '1' }

async function signIn(page: Page) {
  await page.goto('/login')
  await page.keyboard.type('e2e')
  await page.keyboard.press('Tab')
  await page.keyboard.type('e2e-password-123')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('link', { name: 'Debt payoff' })).toBeVisible()
}

test('debt payoff plan and a hand-valued house in net worth', async ({ page }) => {
  await signIn(page)
  const request = page.request
  for (const data of [
    {
      name: 'E2E Car Loan',
      type: 'loan',
      opening_date: '2025-01-01',
      opening_balance_cents: -1_000_000,
      min_payment_cents: 19_333,
    },
    {
      name: 'E2E Store Card',
      type: 'credit_card',
      opening_date: '2025-01-01',
      opening_balance_cents: -60_000,
      apr_bps: 1_999,
      min_payment_cents: 2_500,
    },
  ]) {
    const response = await request.post('/api/v1/accounts', { data, headers: HEADERS })
    expect(response.ok()).toBeTruthy()
  }

  await page.goto('/debt')
  const documentLoads: string[] = []
  page.on('request', (req) => {
    if (req.resourceType() === 'document') documentLoads.push(req.url())
  })

  // The loan has no APR yet: it is left out, with a way to fix it.
  const debts = page.getByTestId('debt-table')
  await expect(debts).toContainText('left out: needs its APR')
  await debts.getByRole('link', { name: 'left out: needs its APR' }).click()
  const apr = page.getByLabel('E2E Car Loan APR')
  await apr.fill('6')
  await page.keyboard.press('Enter')
  await expect(apr).toHaveValue('6.00')

  await page.getByRole('link', { name: 'Debt payoff' }).click()
  await expect(debts).not.toContainText('left out')
  await expect(debts).toContainText('6.00%')
  await expect(page.getByTestId('strategy-avalanche')).toBeVisible()

  // Try an extra $100, pick snowball, save.
  await page.getByLabel('Extra each month').fill('100')
  await page.getByLabel('Snowball (smallest balance first)').check()
  await expect(page.getByTestId('strategy-snowball')).toContainText('(shown below)')
  await page.getByRole('button', { name: 'Save plan' }).click()
  await expect(page.getByRole('button', { name: 'Save plan' })).toBeDisabled()
  const saved = (await (await request.get('/api/v1/debt-plan')).json()) as {
    strategy: string
    extra_monthly_cents: number
  }
  expect(saved).toMatchObject({ strategy: 'snowball', extra_monthly_cents: 10_000 })

  // A house valued by hand.
  await page.getByRole('link', { name: 'Accounts' }).click()
  await page.getByLabel('Account name').fill('E2E House')
  await page.getByLabel('Account type').selectOption('other_asset')
  await page.getByLabel(/type its value in by hand/).check()
  await page.getByRole('button', { name: 'Add account' }).click()
  const row = page.getByRole('listitem').filter({ hasText: 'E2E House' })
  await row.getByRole('button', { name: 'Update value' }).click()
  const panel = page.getByTestId('valuation-panel')
  await panel.getByLabel('Value', { exact: true }).fill('250000')
  await page.keyboard.press('Enter')
  await expect(panel.getByRole('list', { name: 'Past values' })).toContainText('$250,000.00')

  await page.getByRole('link', { name: 'Reports' }).click()
  await page.getByRole('link', { name: 'Net worth' }).click()
  const byType = page.getByTestId('net-worth-by-type-table')
  await expect(byType).toContainText('E2E House')
  await expect(byType.locator('tr', { hasText: 'E2E House' })).toContainText('$250,000.00')
  await expect(byType.locator('tr', { hasText: 'E2E Car Loan' })).toContainText('$10,000.00 owed')

  expect(documentLoads).toEqual([])
})
