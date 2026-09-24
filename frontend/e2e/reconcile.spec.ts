/** Phase 11: reconcile an account to a statement from the keyboard. Finish stays blocked until
 * the difference is zero, the ledger shows locks, a reconciled row is protected, and the
 * reconciliation can be undone — all without a page load.
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
  await expect(page.getByRole('link', { name: 'Transactions' })).toBeVisible()
}

test('reconcile to a statement, then undo it', async ({ page }) => {
  await signIn(page)
  const request = page.request
  const account = (await (
    await request.post('/api/v1/accounts', {
      data: {
        name: 'Reconcile Checking',
        type: 'checking',
        opening_date: '2026-08-01',
        opening_balance_cents: 100_000,
      },
      headers: HEADERS,
    })
  ).json()) as { id: number }
  for (const [date, amount_cents, status] of [
    ['2026-09-02', -4_520, 'cleared'],
    ['2026-09-10', 250_000, 'uncleared'],
    ['2026-09-20', -1_000, 'uncleared'], // not on the statement yet
  ] as const) {
    const response = await request.post('/api/v1/transactions', {
      data: { account_id: account.id, date, amount_cents, status },
      headers: HEADERS,
    })
    expect(response.ok()).toBeTruthy()
  }

  await page.goto(`/transactions/${account.id}`)
  const documentLoads: string[] = []
  page.on('request', (req) => {
    if (req.resourceType() === 'document') documentLoads.push(req.url())
  })
  await page.getByRole('link', { name: 'Reconcile…' }).click()
  await expect(page.getByRole('heading', { name: 'Reconcile Reconcile Checking' })).toBeVisible()

  // The statement: date, Tab, balance, Enter.
  await page.getByLabel('Statement date').fill('2026-09-30')
  await page.keyboard.press('Tab')
  await page.keyboard.type('3454.80')
  await page.keyboard.press('Enter')

  const difference = page.getByTestId('reconcile-difference')
  await expect(difference).toHaveText('$2,500.00')
  await expect(page.getByTestId('reconcile-row')).toHaveCount(3)
  const finish = page.getByRole('button', { name: 'Finish', exact: true })
  await expect(finish).toBeDisabled()

  // First box has focus: ↓ to the payroll row, Space ticks it.
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Space')
  await expect(difference).toHaveText('$0.00')
  await expect(finish).toBeEnabled()
  await finish.click()

  // Back on the ledger: two locks, the open row untouched.
  await expect(page).toHaveURL(new RegExp(`/transactions/${account.id}$`))
  await expect(page.getByTestId('lock-icon')).toHaveCount(2)
  const ledger = (await (
    await request.get(`/api/v1/transactions?account_id=${account.id}`)
  ).json()) as { items: { transaction: { status: string } }[] }
  expect(ledger.items.map((item) => item.transaction.status).sort()).toEqual([
    'reconciled',
    'reconciled',
    'uncleared',
  ])

  // A reconciled row asks before it is unlocked; saying no leaves it locked.
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('reconciled')
    void dialog.dismiss()
  })
  await page.getByRole('button', { name: 'Status: reconciled' }).first().click()
  await expect(page.getByTestId('lock-icon')).toHaveCount(2)

  // Undo from the history.
  await page.getByRole('link', { name: 'Reconcile…' }).click()
  const history = page.getByTestId('reconcile-history')
  await expect(history).toContainText('2026-09-30')
  page.once('dialog', (dialog) => void dialog.accept())
  await history.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByText('Not reconciled yet.')).toBeVisible()
  await page.getByRole('link', { name: 'Back to the ledger' }).click()
  await expect(page.getByTestId('lock-icon')).toHaveCount(0)

  expect(documentLoads).toEqual([])
})
