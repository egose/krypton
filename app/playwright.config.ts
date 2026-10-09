import { defineConfig, devices } from '@playwright/test';

/**
 * Visual smoke suite: boots the production build and asserts icons render
 * inline inside buttons/links on every page. All K8s-backed APIs are mocked
 * per-page — no cluster or IdP needed.
 *
 * `next start` (not the standalone server) is deliberate: standalone needs
 * .next/static copied next to the traced server like the Dockerfile does,
 * otherwise client JS 404s and pages hang in Suspense. `next start` serves
 * the same build output completely.
 *
 *   pnpm build && pnpm e2e           # full run (port 3100)
 *   pnpm e2e --project=chromium-dark # single project
 */
export default defineConfig({
  testDir: './e2e',
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm exec next start --port 3100',
    port: 3100,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium-dark',
      use: { ...devices['Desktop Chrome'], colorScheme: 'dark' },
      testIgnore: /mobile/,
    },
    {
      name: 'chromium-light',
      use: { ...devices['Desktop Chrome'], colorScheme: 'light' },
      testIgnore: /mobile/,
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'], colorScheme: 'dark' },
      testMatch: /mobile/,
    },
  ],
});
