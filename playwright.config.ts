import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PW_PORT ?? 4317);

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  testIgnore: 'screenshots/**',
  outputDir: 'test-results',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  timeout: 60_000,
  use: {
    trace: 'retain-on-failure',
    baseURL: `http://localhost:${port}`
  },
  // App pages run against the in-browser demo backend, from a production build.
  webServer: {
    command: `npm run build && npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Point at an existing Chromium when Playwright's own download isn't available.
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}
      }
    }
  ]
});
