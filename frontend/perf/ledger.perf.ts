import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/** Ledger scrolling and payee typeahead against the 100k demo household (D-110).
 *
 * Limits: while scrolling through 5,000 rows, the 95th-percentile frame stays under
 * 50 ms (20 fps even on a slow box; a smooth run is ~16 ms); each keystroke in the
 * payee typeahead shows its matches within 50 ms at the 95th percentile (SPEC §7).
 */
const SCROLL_ROWS = 5000
const FRAME_P95_MS = 50
const TYPEAHEAD_P95_MS = 50

function pct(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * sorted.length) - 1))]
}

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Username').fill('demo')
  await page.getByLabel('Password').fill(process.env.PB_PERF_PASSWORD ?? 'perf-password-123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('navigation').first()).toBeVisible()
}

test('the ledger scrolls 5,000 rows smoothly and typeahead keeps up', async ({ page }) => {
  await signIn(page)
  await page.goto('/transactions')
  const list = page.getByRole('rowgroup', { name: 'Transactions list' })
  await expect(list.getByRole('row').first()).toBeVisible()

  // Scroll three rows a frame (~10,000 rows a minute, a hard flick), recording every frame.
  const scroll = await list.evaluate(
    async (element, { target, budgetMs }) => {
      const rowHeight = element.querySelector('[role="row"]')?.getBoundingClientRect().height ?? 34
      const frames: number[] = []
      const began = performance.now()
      let last = began
      let stalledMs = 0
      await new Promise<void>((resolve) => {
        function step(now: number) {
          frames.push(now - last)
          last = now
          const before = element.scrollTop
          element.scrollTop += rowHeight * 3
          if (element.scrollTop === before) stalledMs += frames[frames.length - 1]
          const rows = element.scrollTop / rowHeight
          if (rows >= target || now - began > budgetMs) resolve()
          else requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      })
      return {
        frames: frames.slice(1),
        rows: Math.round(element.scrollTop / rowHeight),
        seconds: (performance.now() - began) / 1000,
        stalledMs,
      }
    },
    { target: SCROLL_ROWS, budgetMs: 120_000 },
  )

  const frameP50 = pct(scroll.frames, 50)
  const frameP95 = pct(scroll.frames, 95)
  const long = scroll.frames.filter((ms) => ms > 50).length
  console.log(
    `scroll: ${scroll.rows} rows in ${scroll.seconds.toFixed(1)}s, ${scroll.frames.length} frames, ` +
      `p50 ${frameP50.toFixed(1)} ms, p95 ${frameP95.toFixed(1)} ms, ` +
      `${long} frames over 50 ms, ${(scroll.stalledMs / 1000).toFixed(1)}s waiting for pages`,
  )
  expect(scroll.rows).toBeGreaterThanOrEqual(SCROLL_ROWS)
  expect(frameP95).toBeLessThan(FRAME_P95_MS)

  // Typeahead: from keystroke to the matching suggestions on screen.
  const payee = page.getByRole('group', { name: 'New transaction' }).getByLabel('Payee')
  const timings: number[] = []
  for (const phrase of ['FreshMart Riverside', 'Noodle House Old Town', 'Hardware Depot Harbor']) {
    await payee.fill('')
    for (let i = 1; i <= phrase.length; i++) {
      const typed = phrase.slice(0, i)
      const began = await page.evaluate(() => performance.now())
      await payee.press(phrase[i - 1] === ' ' ? 'Space' : phrase[i - 1])
      const shown = await page.evaluate(
        async ({ expected, since }) => {
          const input = document.activeElement as HTMLInputElement
          const listId = input.getAttribute('aria-controls')
          for (;;) {
            const first = listId
              ? document.getElementById(listId)?.querySelector('[role="option"]')
              : null
            if (input.value === expected && first) return performance.now() - since
            await new Promise((r) => requestAnimationFrame(r))
          }
        },
        { expected: typed, since: began },
      )
      timings.push(shown)
    }
  }
  const typeP50 = pct(timings, 50)
  const typeP95 = pct(timings, 95)
  console.log(
    `typeahead: ${timings.length} keystrokes, p50 ${typeP50.toFixed(1)} ms, p95 ${typeP95.toFixed(1)} ms`,
  )
  expect(typeP95).toBeLessThan(TYPEAHEAD_P95_MS)
})
