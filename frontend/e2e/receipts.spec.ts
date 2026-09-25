/** Phase 15: a receipt added from the keyboard shows a paperclip, previews, is refused to a
 * stranger, and goes when its transaction is deleted — all without a page load.
 */

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const HEADERS = { 'X-PB-Request': '1' }
// A 2×2 red PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64',
)

async function signIn(page: Page) {
  await page.goto('/login')
  await page.keyboard.type('e2e')
  await page.keyboard.press('Tab')
  await page.keyboard.type('e2e-password-123')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('link', { name: 'Transactions' })).toBeVisible()
}

test('a receipt from upload to preview to cleanup', async ({ page, request: stranger }) => {
  await signIn(page)
  const request = page.request
  const account = (await (
    await request.post('/api/v1/accounts', {
      data: { name: 'Receipts Checking', type: 'checking', opening_date: '2026-01-01' },
      headers: HEADERS,
    })
  ).json()) as { id: number }
  const created = await request.post('/api/v1/transactions', {
    data: { account_id: account.id, date: '2026-09-02', amount_cents: -4_520, memo: 'groceries' },
    headers: HEADERS,
  })
  const tx = ((await created.json()) as { transactions: { id: number }[] }).transactions[0]

  await page.goto(`/transactions/${account.id}`)
  const documentLoads: string[] = []
  page.on('request', (req) => {
    if (req.resourceType() === 'document') documentLoads.push(req.url())
  })

  const row = page.getByTestId('ledger-row').first()
  await row.click()
  await page.keyboard.press('r')
  const dialog = page.getByTestId('receipts-dialog')
  await expect(dialog.getByText('No receipts yet.')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Add files' })).toBeFocused()

  await dialog.getByLabel('Receipt files').setInputFiles({
    name: 'till-slip.png',
    mimeType: 'image/png',
    buffer: PNG,
  })
  const receipt = dialog.getByTestId('receipt')
  await expect(receipt).toHaveCount(1)
  await expect(receipt).toContainText('till-slip.png')

  // The preview, then back with Esc, then closed with Esc.
  await receipt.getByRole('button', { name: 'View till-slip.png' }).click()
  await expect(dialog.getByRole('img', { name: 'till-slip.png' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(receipt).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(row.getByRole('button', { name: '1 receipt' })).toBeVisible()

  // Only a signed-in session can fetch it.
  const listed = (await (
    await request.get(`/api/v1/transactions/${tx.id}/attachments`)
  ).json()) as {
    items: { id: number }[]
  }
  const url = `/api/v1/attachments/${listed.items[0].id}`
  expect((await request.get(url)).status()).toBe(200)
  expect((await stranger.get(url)).status()).toBe(401)

  // Deleting the transaction takes the receipt with it.
  await row.click()
  page.once('dialog', (confirm) => void confirm.accept())
  await page.keyboard.press('Delete')
  await expect(page.getByTestId('ledger-row')).toHaveCount(0)
  await expect.poll(async () => (await request.get(url)).status(), { timeout: 10_000 }).toBe(404)

  expect(documentLoads).toEqual([])
})
