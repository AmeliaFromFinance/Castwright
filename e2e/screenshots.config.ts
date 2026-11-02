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
    ignoreHTTPSErrors: true,
    // Real emote and badge images load through the proxy when one is set.
    launchOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
      ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } } : {})
    }
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4318 --strictPort',
    url: 'http://localhost:4318',
    reuseExistingServer: !process.env.CI,
    cwd: '..'
  }
});
