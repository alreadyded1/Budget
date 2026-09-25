import { defineConfig } from '@playwright/test'

/** Browser half of `make perf` (backend/perf/run.py starts the server and the demo data).
 *
 * Not part of `make e2e`: it needs the 100k-transaction demo household.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.perf.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  reporter: 'list',
  use: {
    baseURL: process.env.PB_PERF_URL ?? 'http://127.0.0.1:8766',
    viewport: { width: 1400, height: 900 },
    launchOptions: process.env.PB_CHROMIUM_PATH
      ? { executablePath: process.env.PB_CHROMIUM_PATH }
      : {},
  },
})
