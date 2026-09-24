import { defineConfig } from '@playwright/test'

const port = Number(process.env.PB_E2E_PORT ?? 8765)

/** End-to-end tests against a real backend with a throwaway database (e2e/serve.sh).
 *
 * Browsers are installed natively with `npx playwright install chromium`. Point
 * PB_CHROMIUM_PATH at an existing Chromium to use that one instead.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    launchOptions: process.env.PB_CHROMIUM_PATH
      ? { executablePath: process.env.PB_CHROMIUM_PATH }
      : {},
  },
  webServer: {
    command: 'bash e2e/serve.sh',
    url: `http://127.0.0.1:${port}/api/v1/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: 'pipe',
  },
})
