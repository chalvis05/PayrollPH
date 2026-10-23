import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke test against a running deployment (deploy/deploy.sh). It needs a FRESH database:
 * the first step is the setup wizard.
 *   BASE_URL=http://localhost:8080 pnpm --filter @payrollph/web exec playwright test
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
