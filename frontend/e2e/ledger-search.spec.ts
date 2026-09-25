/** Phase 16: the ledger's search and filter bar from the keyboard (SPEC §7). Uses an
 * account of its own, so the other specs' rows never match.
 */

import { AxeBuilder } from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

const HEADERS = { 'X-PB-Request': '1' }

async function post<T>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await request.post(`/api/v1${path}`, { data, headers: HEADERS })
  expect(response.ok(), `${path} → ${response.status()} ${await response.text()}`).toBeTruthy()
  return (await response.json()) as T
}

test('search, category and status filters narrow the ledger without a page load', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('pb.setup.skipped', '1'))
  await page.goto('/login')
  await page.keyboard.type('e2e')
  await page.keyboard.press('Tab')
  await page.keyboard.type('e2e-password-123')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('link', { name: 'Transactions' })).toBeVisible()

  const request = page.request
  const account = await post<{ id: number }>(request, '/accounts', {
    name: 'Search Checking',
    type: 'checking',
    opening_balance_cents: 50_000,
    opening_date: '2026-01-01',
  })
  const groups = (await (await request.get('/api/v1/category-groups')).json()) as {
    items: { categories: { id: number; name: string }[] }[]
  }
  const category = (name: string) =>
    groups.items.flatMap((group) => group.categories).find((row) => row.name === name)!.id
  const rows = [
    { memo: 'weekly shop', amount: -8_400, category: 'Groceries', status: 'cleared' },
    { memo: 'pizza night', amount: -3_150, category: 'Dining out', status: 'uncleared' },
    { memo: 'second shop', amount: -2_275, category: 'Groceries', status: 'uncleared' },
    { memo: 'train fare', amount: -1_200, category: 'Parking and tolls', status: 'cleared' },
  ]
  for (const [index, row] of rows.entries()) {
    await post(request, '/transactions', {
      account_id: account.id,
      date: `2026-03-0${index + 1}`,
      amount_cents: row.amount,
      memo: row.memo,
      status: row.status,
      splits: [{ amount_cents: row.amount, category_id: category(row.category) }],
    })
  }

  await page.goto(`/transactions/${account.id}`)
  const ledgerRows = page.getByTestId('ledger-row')
  await expect(ledgerRows).toHaveCount(4)
  const documentLoads: string[] = []
  page.on('request', (req) => {
    if (req.resourceType() === 'document') documentLoads.push(req.url())
  })

  // "/" jumps to search; typing narrows the rows.
  await page.getByRole('rowgroup', { name: 'Transactions list' }).focus()
  await page.keyboard.press('/')
  const search = page.getByLabel('Search payee and memo')
  await expect(search).toBeFocused()
  await page.keyboard.type('shop')
  await expect(ledgerRows).toHaveCount(2)
  await expect(ledgerRows.first()).toContainText('second shop')

  // Status on top of the search: only the uncleared shop.
  await page.getByLabel('Status filter').selectOption('uncleared')
  await expect(ledgerRows).toHaveCount(1)
  await expect(ledgerRows.first()).toContainText('second shop')

  // Clear search and status, filter by category instead.
  await search.fill('')
  await page.getByLabel('Status filter').selectOption('')
  await expect(ledgerRows).toHaveCount(4)
  await page.getByLabel('Category filter').selectOption({ label: 'Food: Dining out' })
  await expect(ledgerRows).toHaveCount(1)
  await expect(ledgerRows.first()).toContainText('pizza night')
  await page.getByLabel('Category filter').selectOption('')
  await expect(ledgerRows).toHaveCount(4)

  // Editing a row: its category list sits on top of the rows below it (repair list #3).
  await page.getByRole('rowgroup', { name: 'Transactions list' }).focus()
  await page.keyboard.press('j')
  await page.keyboard.press('Enter')
  const editor = page.getByTestId('edit-row')
  await expect(editor).toBeVisible()
  await editor.getByLabel('Category').focus()
  await page.keyboard.type('p')
  const list = editor.getByRole('listbox')
  await expect(list.getByRole('option').nth(2)).toBeVisible()
  const covered = await list.evaluate((element) =>
    Array.from(element.querySelectorAll('[role="option"]'))
      .slice(0, 4)
      .map((option) => {
        const box = option.getBoundingClientRect()
        const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
        return top !== null && element.contains(top)
      }),
  )
  expect(covered).toEqual([true, true, true, true])
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)

  // The date calendar closes once a day is picked (repair list: Safari's stayed open).
  const entry = page.getByTestId('entry-row')
  await entry.getByRole('button', { name: 'Open calendar' }).click()
  const calendar = page.getByRole('dialog', { name: 'Choose a date' })
  await expect(calendar).toBeVisible()
  const topmost = await calendar.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const top = document.elementFromPoint(box.left + box.width / 2, box.bottom - 12)
    return top !== null && element.contains(top)
  })
  expect(topmost).toBe(true)
  const axe = await new AxeBuilder({ page }).include('[data-testid="date-picker"]').analyze()
  const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([])
  const firstDay = calendar.locator('[data-date$="-01"]').first()
  const picked = (await firstDay.getAttribute('data-date'))!
  await firstDay.click()
  await expect(calendar).toHaveCount(0)
  await expect(entry.getByLabel('Date')).toHaveValue(picked)
  await expect(entry.getByLabel('Date')).toBeFocused()

  expect(documentLoads).toEqual([])
})
