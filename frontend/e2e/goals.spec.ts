/** Phase 13: a sinking fund added from the keyboard, its suggested contribution pushed into
 * this pay period's plan, and its balance shown on the planner — all without a page load.
 */

import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'

const HEADERS = { 'X-PB-Request': '1' }

async function signIn(page: Page) {
  await page.goto('/login')
  await page.keyboard.type('e2e')
  await page.keyboard.press('Tab')
  await page.keyboard.type('e2e-password-123')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('link', { name: 'Goals' })).toBeVisible()
}

function iso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

async function ensureSchedule(request: APIRequestContext) {
  const current = await request.get('/api/v1/pay-periods/current')
  if (current.ok()) return
  const today = new Date()
  const anchor = iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 3))
  const response = await request.post('/api/v1/pay-schedule', {
    data: { frequency: 'biweekly', effective_from: anchor, anchor_date: anchor },
    headers: HEADERS,
  })
  expect(response.ok()).toBeTruthy()
}

test('a sinking fund from goal to plan to planner', async ({ page }) => {
  await signIn(page)
  const request = page.request
  await ensureSchedule(request)
  const current = (await (await request.get('/api/v1/pay-periods/current')).json()) as {
    id: number
    end_date: string
  }
  const later = (await (
    await request.get(`/api/v1/pay-periods?from=${current.end_date}&to=2099-12-31`)
  ).json()) as { items: { start_date: string; end_date: string }[] }
  // Two periods after this one: this one, the next, and that one are left.
  const target = later.items[2].end_date
  const group = (await (
    await request.post('/api/v1/category-groups', { data: { name: 'E2E Goals' }, headers: HEADERS })
  ).json()) as { id: number }
  const created = await request.post('/api/v1/categories', {
    data: { group_id: group.id, name: 'E2E Holiday Fund' },
    headers: HEADERS,
  })
  expect(created.ok()).toBeTruthy()

  await page.goto('/goals')
  const documentLoads: string[] = []
  page.on('request', (req) => {
    if (req.resourceType() === 'document') documentLoads.push(req.url())
  })

  await page.getByRole('button', { name: 'Add goal' }).click()
  const form = page.getByTestId('goal-form')
  await expect(form.getByLabel('Goal name')).toBeFocused()
  const keys = page.keyboard
  await keys.type('Holiday')
  await keys.press('Tab')
  await keys.type('600')
  await keys.press('Tab')
  await keys.type(target)
  await keys.press('Tab')
  await keys.type('E2E Holi')
  await keys.press('Tab') // picks the category
  await keys.type('100')
  await keys.press('Enter')

  const card = page.getByTestId('goal-card').filter({ hasText: 'Holiday' })
  await expect(card.getByTestId('goal-needed')).toHaveText('$166.67 × 3')
  await expect(card.getByTestId('goal-progress')).toContainText('of $600.00')

  await card.getByRole('button', { name: 'Use suggested contribution ($166.67)' }).click()
  await expect(card.getByTestId('goal-status')).toHaveText('● On track')
  await expect(card.getByRole('button', { name: /Use suggested contribution/ })).toHaveCount(0)

  await page.getByRole('link', { name: 'Budget' }).click()
  await expect(page.getByTestId('fund-E2E Holiday Fund')).toHaveText('Fund $266.67')

  expect(documentLoads).toEqual([])
})
