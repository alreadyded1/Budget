/** Phase 16: the first-run wizard (SPEC §17, D-106). Runs first ("aa-"), while the
 * throwaway household has categories but no pay schedule and no accounts.
 *
 * It makes the same biweekly schedule the budget spec would (anchored three days ago),
 * and it never lets the dashboard load: opening the dashboard prefills the current
 * period's plan (D-056), which the budget spec checks against its own template.
 */

import { expect, test } from '@playwright/test'

function iso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

test('first run: pay schedule, an account, categories, finish', async ({ page }) => {
  await page.route('**/api/v1/dashboard', (route) => route.abort())
  const documentLoads: string[] = []

  await page.goto('/login')
  await page.keyboard.type('e2e')
  await page.keyboard.press('Tab')
  await page.keyboard.type('e2e-password-123')
  await page.keyboard.press('Enter')

  // Nothing set up yet: signing in lands on the wizard.
  await expect(page).toHaveURL(/\/setup$/)
  await expect(page.getByRole('heading', { name: 'Set up Payday Budget' })).toBeVisible()
  page.on('request', (req) => {
    if (req.resourceType() === 'document') documentLoads.push(req.url())
  })
  const steps = page.getByRole('list', { name: 'Setup steps' })
  await expect(steps.getByRole('button', { name: '1. Pay schedule' })).toHaveAttribute(
    'aria-current',
    'step',
  )
  const next = page.getByRole('button', { name: 'Next' })
  await expect(next).toBeDisabled()

  // Step 1, from the keyboard: every other Friday-or-whatever, starting three days ago.
  const today = new Date()
  const anchor = iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 3))
  await page.getByLabel('How often are you paid?').selectOption('biweekly')
  await page.getByLabel('A pay date to count from').fill(anchor)
  await page.getByLabel('Starting from').fill(anchor)
  await expect(page.getByRole('heading', { name: 'Next six periods' })).toBeVisible()
  await page.getByRole('button', { name: 'Save schedule' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Pay schedule saved.')).toBeVisible()
  await expect(steps.getByRole('button', { name: '1. Pay schedule ✓' })).toBeVisible()
  await expect(next).toBeEnabled()
  await next.focus()
  await page.keyboard.press('Enter')

  // Step 2: one account.
  await expect(page.getByTestId('setup-step-1')).toBeVisible()
  await expect(next).toBeDisabled()
  await page.getByLabel('Account name').fill('Setup Checking')
  await page.getByLabel('Account type').selectOption('checking')
  await page.getByLabel('Opening balance').fill('1,250.00')
  await page.keyboard.press('Enter')
  await expect(
    page.getByTestId('setup-step-1').getByRole('link', { name: 'Setup Checking' }),
  ).toBeVisible()
  await expect(next).toBeEnabled()
  await next.focus()
  await page.keyboard.press('Enter')

  // Step 3: the starter categories are already there (serve.sh seeds them).
  await expect(page.getByTestId('setup-step-2')).toContainText(/You have \d+ categories/)
  await page.getByRole('button', { name: 'Finish' }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/$/)

  // Set up now: the ledger opens instead of the wizard, with the opening balance.
  await page.getByRole('link', { name: 'Transactions' }).click()
  await expect(page).toHaveURL(/\/transactions$/)
  await expect(page.getByRole('navigation', { name: 'Accounts' })).toContainText('Setup Checking')

  // Settings → General can run it again; it opens on the first unfinished step (none).
  await page.goto('/settings')
  await page.getByRole('link', { name: 'Run setup again' }).click()
  await expect(page).toHaveURL(/\/setup$/)
  await expect(page.getByTestId('setup-step-2')).toBeVisible()

  expect(documentLoads.filter((url) => !url.endsWith('/settings'))).toEqual([])
})
