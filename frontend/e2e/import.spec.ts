/** Phase 10: a CSV statement is mapped once, reviewed from the keyboard, committed, flagged as
 * duplicates when imported again, and undone — all without a page load.
 */

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const HEADERS = { 'X-PB-Request': '1' }

const CSV = `Date,Description,Amount
09/02/2026,KROGER #0423,-45.20
09/04/2026,SHELL OIL 5741,-38.00
09/10/2026,ACME PAYROLL,"2,500.00"
`

async function signIn(page: Page) {
  await page.goto('/login')
  await page.keyboard.type('e2e')
  await page.keyboard.press('Tab')
  await page.keyboard.type('e2e-password-123')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('link', { name: 'Transactions' })).toBeVisible()
}

async function chooseFile(page: Page) {
  await page.getByLabel('Statement file').setInputFiles({
    name: 'statement.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(CSV),
  })
}

test('import a CSV, match a typed entry, re-import as duplicates, undo', async ({ page }) => {
  await signIn(page)
  const request = page.request
  const account = (await (
    await request.post('/api/v1/accounts', {
      data: { name: 'Import Checking', type: 'checking', opening_date: '2026-01-01' },
      headers: HEADERS,
    })
  ).json()) as { id: number }
  // Typed by hand a day before the bank posted it: the import should clear it, not copy it.
  const manual = (await (
    await request.post('/api/v1/transactions', {
      data: { account_id: account.id, date: '2026-09-03', amount_cents: -3800, memo: 'fuel' },
      headers: HEADERS,
    })
  ).json()) as { transactions: { id: number }[] }

  await page.goto(`/transactions/${account.id}`)
  const documentLoads: string[] = []
  page.on('request', (req) => {
    if (req.resourceType() === 'document') documentLoads.push(req.url())
  })
  await page.getByRole('link', { name: 'Import…' }).click()
  await expect(page.getByRole('heading', { name: 'Import a statement' })).toBeVisible()

  await chooseFile(page)
  await expect(page.getByLabel('Bank format')).toHaveValue('new')
  await page.getByRole('button', { name: 'Continue' }).click()

  // Mapping: the guess is right, so name it and press Enter.
  const mapping = page.getByTestId('mapping-step')
  await expect(mapping.getByTestId('mapping-preview')).toContainText('KROGER #0423')
  await expect(mapping.getByTestId('mapping-preview')).toContainText('$2,500.00')
  await expect(mapping.getByLabel('Bank format name')).toBeFocused()
  await page.keyboard.type('E2E Bank CSV')
  await page.keyboard.press('Enter')

  // Review.
  const review = page.getByTestId('review-step')
  await expect(review.getByTestId('review-row')).toHaveCount(3)
  await expect(review.getByTestId('review-row').nth(1).getByTestId('match-note')).toContainText(
    'Marks your entry of 2026-09-03',
  )
  await review.getByLabel('Payee for row 1').focus()
  await page.keyboard.type('Import Grocer')
  await page.keyboard.press('Tab') // picks "Create 'Import Grocer'"
  await expect(review.getByTestId('review-row').first()).toContainText('new payee')
  await expect(review.getByTestId('review-summary')).toContainText('2 new, 1 matched, 0 skipped')
  await review.getByRole('button', { name: 'Commit import' }).click()

  // Back on the ledger with the result.
  await expect(page).toHaveURL(new RegExp(`/transactions/${account.id}$`))
  await expect(page.getByTestId('account-balance')).toHaveText('$2,416.80')
  const ledger = (await (
    await request.get(`/api/v1/transactions?account_id=${account.id}`)
  ).json()) as { items: { transaction: { id: number; status: string; memo: string | null } }[] }
  expect(ledger.items).toHaveLength(3)
  const kept = ledger.items.find((item) => item.transaction.id === manual.transactions[0].id)
  expect(kept?.transaction.status).toBe('cleared')
  expect(kept?.transaction.memo).toBe('fuel')

  // The same file again: every row is already imported, and the saved format is picked.
  await page.getByRole('link', { name: 'Import…' }).click()
  await chooseFile(page)
  await expect(page.getByLabel('Bank format')).not.toHaveValue('new')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByTestId('review-row').getByText('already imported')).toHaveCount(3)
  await expect(page.getByTestId('review-summary')).toContainText('0 new, 0 matched, 3 skipped')
  await page.getByRole('button', { name: 'Discard' }).click()

  // Undo the first import from the history.
  const history = page.getByTestId('import-history')
  await expect(history).toContainText('2 imported, 1 matched')
  page.once('dialog', (dialog) => void dialog.accept())
  await history.getByRole('button', { name: 'Undo' }).click()
  await expect(history).toContainText('undone')
  await expect
    .poll(async () => {
      const after = (await (
        await request.get(`/api/v1/transactions?account_id=${account.id}`)
      ).json()) as { items: { transaction: { status: string } }[] }
      return after.items.map((item) => item.transaction.status)
    })
    .toEqual(['uncleared'])

  expect(documentLoads).toEqual([])

  // Undo keeps payees; drop ours so later specs see only their own.
  const payees = (await (await request.get('/api/v1/payees?search=Import%20Grocer')).json()) as {
    items: { id: number }[]
  }
  expect(payees.items).toHaveLength(1)
  const removed = await request.delete(`/api/v1/payees/${payees.items[0].id}`, { headers: HEADERS })
  expect(removed.status()).toBe(204)
})
