/** Phase 16: no serious or critical accessibility problems on the main screens, in light and
 * dark (axe-core, the rules behind Lighthouse's accessibility score).
 *
 * Named to run last: the specs share one server, and opening the planner here first would
 * prefill the period before the planner spec sets its template. Last, it also sees every
 * other spec's data.
 */

import { AxeBuilder } from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'

const HEADERS = { 'X-PB-Request': '1' }

function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Enough data that rows, cards and charts are on screen, not only empty states. */
async function seed(request: APIRequestContext) {
  const post = async (path: string, data: unknown) => {
    const response = await request.post(`/api/v1${path}`, { data, headers: HEADERS })
    expect(response.ok(), `${path} → ${response.status()}`).toBeTruthy()
    return response.json()
  }
  if (!(await request.get('/api/v1/pay-periods/current')).ok()) {
    const today = new Date()
    const anchor = iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 3))
    await post('/pay-schedule', {
      frequency: 'biweekly',
      effective_from: anchor,
      anchor_date: anchor,
    })
  }
  const today = iso(new Date())
  const account = await post('/accounts', {
    name: 'A11y Checking',
    type: 'checking',
    opening_date: '2026-01-01',
    opening_balance_cents: 150_000,
  })
  const card = await post('/accounts', {
    name: 'A11y Card',
    type: 'credit_card',
    opening_date: '2026-01-01',
    opening_balance_cents: -40_000,
    apr_bps: 1999,
    min_payment_cents: 2_500,
  })
  const groups = (await (await request.get('/api/v1/category-groups')).json()) as {
    items: { kind: string; categories: { id: number; name: string }[] }[]
  }
  const category = groups.items
    .filter((g) => g.kind === 'expense')
    .flatMap((g) => g.categories)
    .find((c) => c.name !== 'Groceries')!
  for (const [cents, cleared] of [
    [-4_520, 'cleared'],
    [-1_250, 'uncleared'],
    [250_000, 'cleared'],
  ] as const) {
    await post('/transactions', {
      account_id: account.id,
      date: today,
      amount_cents: cents,
      status: cleared,
      memo: 'a11y',
      splits: [{ amount_cents: cents, category_id: category.id }],
    })
  }
  await post('/transfers', {
    from_account_id: account.id,
    to_account_id: card.id,
    date: today,
    amount_cents: 5_000,
  })
  await post('/subscriptions', { name: 'A11y Stream', amount_cents: 1_599, anchor_date: today })
  await post('/goals', {
    name: 'A11y Fund',
    type: 'sinking_fund',
    target_cents: 60_000,
    category_id: category.id,
  })
}

const SCREENS = [
  '/',
  '/budget',
  '/transactions',
  '/accounts',
  '/goals',
  '/debt',
  '/subscriptions',
  '/calendar',
  '/reports/spending',
  '/reports/net-worth',
  '/payees',
  '/import',
  '/settings',
  '/settings/rules',
  '/settings/data',
]

async function signIn(page: Page) {
  await page.goto('/login')
  const login = await new AxeBuilder({ page }).analyze()
  expect(serious(login.violations), 'login page').toEqual([])
  await page.keyboard.type('e2e')
  await page.keyboard.press('Tab')
  await page.keyboard.type('e2e-password-123')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
}

function serious(
  violations: { id: string; impact?: string | null; nodes: { target: unknown }[] }[],
) {
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => JSON.stringify(n.target)).join(' ')}`)
}

for (const theme of ['light', 'dark'] as const) {
  test(`main screens have no serious accessibility problems (${theme})`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('pb.theme', value), theme)
    await page.addInitScript(() => localStorage.setItem('pb.setup.skipped', '1'))
    await signIn(page)
    if (theme === 'light') await seed(page.request)
    const problems: string[] = []
    for (const path of SCREENS) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await expect(page.getByText('Loading…')).toHaveCount(0)
      const result = await new AxeBuilder({ page }).analyze()
      problems.push(...serious(result.violations).map((line) => `${path} ${line}`))
    }
    expect(problems).toEqual([])
  })
}
