/** Phase 16: Settings → Data downloads (D-107). Runs after most specs, so the household
 * has plenty in it; checks the files' shape and that no secret leaves the server.
 */

import { readFile } from 'node:fs/promises'

import { expect, test } from '@playwright/test'

test('export everything as JSON and the transactions as CSV', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pb.setup.skipped', '1'))
  await page.goto('/login')
  await page.keyboard.type('e2e')
  await page.keyboard.press('Tab')
  await page.keyboard.type('e2e-password-123')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('link', { name: 'Transactions' })).toBeVisible()

  await page.goto('/settings/data')
  const csvLink = page.getByRole('link', { name: 'Download transactions.csv' })
  const [csvDownload] = await Promise.all([page.waitForEvent('download'), csvLink.click()])
  expect(csvDownload.suggestedFilename()).toMatch(/\.csv$/)
  const csv = await readFile((await csvDownload.path())!, 'utf8')
  const [header, ...lines] = csv.trim().split(/\r?\n/)
  expect(header).toBe(
    'date,account,payee,category_group,category,amount,memo,split_memo,transaction_amount,status,check_number,transfer_account,transaction_id',
  )
  expect(lines.length).toBeGreaterThan(5)
  expect(lines.some((line) => line.includes('Setup Checking') || line.includes('Checking'))).toBe(
    true,
  )

  const jsonLink = page.getByRole('link', { name: 'Download the JSON export' })
  const [jsonDownload] = await Promise.all([page.waitForEvent('download'), jsonLink.click()])
  expect(jsonDownload.suggestedFilename()).toMatch(/\.json$/)
  const text = await readFile((await jsonDownload.path())!, 'utf8')
  const data = JSON.parse(text) as {
    app: string
    tables: Record<string, Record<string, unknown>[]>
  }
  expect(data.app).toBeTruthy()
  expect(Object.keys(data.tables)).toEqual(
    expect.arrayContaining(['accounts', 'transactions', 'transaction_splits', 'users']),
  )
  expect(data.tables.transactions.length).toBeGreaterThan(5)
  expect(data.tables).not.toHaveProperty('sessions')
  expect(data.tables.users.every((user) => !('password_hash' in user))).toBe(true)
  expect(text).not.toContain('password_hash')
  expect(text).not.toContain('ntfy_token')
})
