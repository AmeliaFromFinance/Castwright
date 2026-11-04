import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubProviders } from '../providers';

const screens = join(dirname(fileURLToPath(import.meta.url)), '__screens__');

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || (m.type() === 'warning' && m.text().includes('[svelte]'))) errors.push(`console: ${m.text()}`);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await stubProviders(page);
  await page.goto('/?demo=static');
  await expect(page.locator('.splash')).toHaveCount(0);
  return errors;
}

test("what's new shows once after an update", async ({ page }) => {
  mkdirSync(screens, { recursive: true });
  // Last opened with an older build; the demo is 1.0.1. Only on the first load.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('cw.whatsnew-seen', JSON.stringify('1.0.0'));
  });
  const errors = await open(page);
  const dialog = page.getByRole('dialog', { name: "What's new in v1.0.1" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Released 2026-11-03');
  await expect(dialog.getByRole('heading', { name: 'Changed', exact: true })).toBeVisible();
  await expect(dialog).toContainText('New logo and app icon.');
  await page.screenshot({ path: join(screens, 'whats-new.png') });
  await dialog.getByRole('button', { name: 'Got it' }).click();
  await expect(dialog).toHaveCount(0);

  await page.reload();
  await expect(page.locator('.splash')).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(page.getByRole('dialog', { name: /What's new/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a fresh install doesn't show what's new; palette and About do", async ({ page }) => {
  const errors = await open(page);
  await page.waitForTimeout(300);
  await expect(page.getByRole('dialog', { name: /What's new/ })).toHaveCount(0);

  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill("what's new");
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: "What's new in v1.0.1" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'About' }).click();
  await page.getByRole('button', { name: "What's new" }).click();
  await expect(dialog).toBeVisible();
  expect(errors).toEqual([]);
});
