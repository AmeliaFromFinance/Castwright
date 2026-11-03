import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubProviders } from '../providers';

const screens = join(dirname(fileURLToPath(import.meta.url)), '__screens__');

async function open(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || (m.type() === 'warning' && m.text().includes('[svelte]'))) errors.push(`console: ${m.text()}`);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await stubProviders(page);
  await page.goto(`/?${query}`);
  await expect(page.locator('.splash')).toHaveCount(0);
  return errors;
}

test('summary after the stream ends: view, copy and export', async ({ page, context }) => {
  mkdirSync(screens, { recursive: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors = await open(page, 'demo=static&ended');

  const toast = page.getByRole('status').filter({ hasText: 'Stream summary ready' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'View' }).click();

  const dialog = page.getByRole('dialog', { name: 'Stream summary' });
  const card = dialog.getByRole('article', { name: 'Stream summary' });
  await expect(card).toContainText('Ranked grind and overlay tinkering');
  await expect(card).toContainText('New follows');
  await expect(card).toContainText('Top chatters');
  await expect(card.getByRole('img', { name: 'Events and chat per 10 minutes' })).toBeVisible();
  await expect(card.locator('svg path').first()).toBeAttached();
  await expect(card.getByText('LIVE')).toHaveCount(0);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: join(screens, 'session-summary.png') });

  await dialog.getByRole('button', { name: 'Copy for socials' }).click();
  await expect(page.getByText('Summary copied')).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toMatch(/^Thanks for hanging out! 1h 2\dm of Just Chatting with a peak of 1,342 viewers\./);
  expect(text).toContain('new follows');

  const csv = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'CSV' }).click();
  expect((await csv).suggestedFilename()).toMatch(/^stream-\d{4}-\d\d-\d\d\.csv$/);
  const png = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Image' }).click();
  const image = await png;
  expect(image.suggestedFilename()).toMatch(/\.png$/);
  await image.saveAs(join(screens, 'session-summary-image.png'));
  await expect(page.getByText('Image saved')).toBeVisible();
  expect(errors).toEqual([]);
});

test('sessions list, palette, template and delete', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors = await open(page, 'demo=static');

  // The template in settings drives "Copy for socials".
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Stream summary' }).click();
  const field = page.getByRole('textbox', { name: 'Copy for socials text' });
  await field.fill('GG! ');
  await page.getByRole('group', { name: 'Insert into Copy for socials text' }).getByRole('button', { name: 'follows', exact: true }).click();
  await expect(field).toHaveValue('GG! {{follows}}');
  await expect(page.getByText('Preview from your last stream')).toBeVisible();

  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('past streams');
  await page.keyboard.press('Enter');
  const rows = page.getByRole('table', { name: 'Past streams' }).locator('tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('LIVE');

  await rows.nth(1).click();
  const dialog = page.getByRole('dialog', { name: 'Stream summary' });
  await expect(dialog).toContainText('Celeste any% practice');
  await expect(dialog).toContainText('pixelbyte');
  await dialog.getByRole('button', { name: 'Copy for socials' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('GG! 38');

  await dialog.getByRole('button', { name: 'Delete' }).click();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Stream deleted')).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(rows).toHaveCount(2);

  // A live stream can't be deleted yet.
  await rows.first().click();
  await expect(dialog.getByRole('button', { name: 'Delete' })).toBeDisabled();
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('last stream summary');
  await page.keyboard.press('Enter');
  await expect(dialog).toContainText('Ranked grind and overlay tinkering');
  expect(errors).toEqual([]);
});
