import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubProviders } from '../providers';

const screens = join(dirname(fileURLToPath(import.meta.url)), '__screens__');
let errors: string[] = [];

test.beforeAll(() => mkdirSync(screens, { recursive: true }));

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await stubProviders(page);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test.afterEach(() => {
  expect(errors, 'no page or console errors').toEqual([]);
});

async function addCredits(page: Page) {
  await page.goto('/?demo=static', { timeout: 90_000 });
  await page.getByRole('button', { name: 'Overlays', exact: true }).click();
  await page.locator('[data-overlay-card]').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Add credits layer' }).click();
  return page.locator('.cw-stage [data-layer-type="credits"] .cw-credits');
}

const offset = (page: Page) =>
  page.locator('.cw-stage .cw-credits-roll').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42);

test('a credits layer shows the demo stream and rolls on request', async ({ page }) => {
  const credits = await addCredits(page);
  await expect(credits.locator('.cw-credits-heading')).toHaveText('Thanks for watching!');
  // Names come from the demo stream that is live.
  await expect(credits.locator('.cw-credits-section[data-kind="followers"] .cw-credits-row').first()).toBeVisible();
  await expect(credits.locator('.cw-credits-section[data-kind="moderators"]')).toContainText('pixelbyte');
  await expect(credits.locator('.cw-credits-section[data-kind="cheerers"] .cw-credits-amount').first()).toHaveText(/bits$/);

  await page.getByRole('button', { name: 'Roll now' }).click();
  await expect(credits).toHaveClass(/cw-rolling/);
  const a = await offset(page);
  await page.waitForTimeout(600);
  expect(await offset(page)).toBeLessThan(a);

  // Turn a section off and rename another.
  await page.getByRole('switch', { name: 'Show Moderators' }).click();
  await expect(credits.locator('.cw-credits-section[data-kind="moderators"]')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Title for New followers' }).fill('Welcome aboard');
  await expect(credits.locator('.cw-credits-section[data-kind="followers"] .cw-credits-title')).toHaveText('Welcome aboard');
  await page.getByRole('button', { name: 'Move Subscribers up' }).click();
  const kinds = await credits.locator('.cw-credits-section').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')));
  expect(kinds.slice(0, 2)).toEqual(['subscribers', 'followers']);
});

test('reduced motion shows pages instead of scrolling', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const credits = await addCredits(page);
  await expect(credits).toHaveClass(/cw-paged/);
  await page.getByRole('button', { name: 'Roll now' }).click();
  await page.waitForTimeout(500);
  expect(await offset(page)).toBe(0);
});
