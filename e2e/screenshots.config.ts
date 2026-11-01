import { defineConfig, devices } from '@playwright/test';

// Captures the docs screenshots from the demo backend: `npm run screenshots`.
export default defineConfig({
  testDir: 'screenshots',
  outputDir: '../test-results/screenshots',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:4318',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}
  },
  webServer: {
    command: 'npx vite --port 4318 --strictPort',
    url: 'http://localhost:4318',
    reuseExistingServer: !process.env.CI,
    cwd: '..'
  }
});
