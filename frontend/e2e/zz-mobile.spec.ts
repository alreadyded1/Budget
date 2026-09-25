/** Phase 16: usable on a phone (SPEC §18) — no screen scrolls sideways at 390 px, the menu
 * opens from the top bar, and the ledger shows card rows. Runs last, on every spec's data.
 */

import { expect, test } from '@playwright/test'

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
  '/payees',
  '/settings',
]

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

test('main screens fit a phone', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('pb.setup.skipped', '1'))
  await page.goto('/login')
  await page.getByLabel('Username').fill('e2e')
  await page.getByLabel('Password').fill('e2e-password-123')
  await page.keyboard.press('Enter')

  // The menu lives behind a button in the top bar.
  const menu = page.getByRole('button', { name: 'Menu' })
  await expect(menu).toBeVisible()
  await menu.click()
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Transactions' })
    .click()
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible()
  await expect(page.getByTestId('ledger-row').first()).toBeVisible()
  const row = await page.getByTestId('ledger-row').first().boundingBox()
  expect(row?.height).toBeGreaterThanOrEqual(56) // a card, easy to tap

  const wide: string[] = []
  for (const path of SCREENS) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    if (overflow > 1) wide.push(`${path} is ${overflow}px too wide`)
    await page.screenshot({
      path: testInfo.outputPath(`${path.replaceAll('/', '_') || 'home'}.png`),
    })
  }
  expect(wide).toEqual([])
})
