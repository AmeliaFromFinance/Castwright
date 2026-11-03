import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubProviders } from '../providers';

const screens = join(dirname(fileURLToPath(import.meta.url)), '__screens__');

let errors: string[] = [];

test.beforeAll(() => {
  mkdirSync(screens, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || (m.type() === 'warning' && m.text().includes('[svelte]'))) errors.push(`console: ${m.text()}`);
  });
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await stubProviders(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?demo=static');
  await page.getByRole('button', { name: 'Overlays', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overlays' })).toBeVisible();
});

test.afterEach(() => {
  expect(errors, 'no page or console errors').toEqual([]);
});

/** Click the tile or size whose radio is called `name`. */
const pick = (dlg: Locator, name: string) => dlg.locator('label', { has: dlg.page().getByRole('radio', { name, exact: true }) }).click();

async function openPicker(page: Page) {
  await page.getByRole('button', { name: 'New overlay' }).first().click();
  const dlg = page.getByRole('dialog', { name: 'New overlay' });
  await expect(dlg).toBeVisible();
  return dlg;
}

test('creates an overlay from a template', async ({ page }) => {
  const dlg = await openPicker(page);
  for (const name of ['Blank', 'Just Chatting', 'Gameplay', 'Starting soon', 'BRB', 'Ending', 'Vertical']) {
    await expect(dlg.getByRole('radio', { name, exact: true })).toHaveCount(1);
  }
  // Every template shows a live preview.
  await expect(dlg.locator('.preview .cw-stage')).toHaveCount(6);
  await expect(dlg.locator('.preview [data-layer-type="timer"]').first()).toHaveText(/\d\d:\d\d/);
  await pick(dlg, 'Starting soon');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(screens, 'overlay-templates.png') });

  await expect(dlg.getByLabel('Name', { exact: true })).toHaveValue('Starting soon');
  await expect(dlg.getByText('match the Browser Source')).toHaveCount(0);
  await dlg.getByRole('button', { name: 'Create overlay' }).click();

  await expect(page.getByLabel('Overlay name')).toHaveValue('Starting soon');
  const rows = page.locator('[data-layer-row]');
  await expect(rows).toHaveCount(10);
  await expect(rows.filter({ hasText: 'Countdown' })).toHaveCount(1);
  await expect(page.locator('.cw-stage [data-layer-type="timer"]')).toHaveText(/0[45]:\d\d/);
});

test('blank overlays still ask for a size', async ({ page }) => {
  const dlg = await openPicker(page);
  await pick(dlg, 'Vertical');
  await pick(dlg, 'Blank');
  await expect(dlg.getByLabel('Name', { exact: true })).toHaveValue('New overlay');
  await pick(dlg, '1080 × 1920');
  await dlg.getByRole('button', { name: 'Create overlay' }).click();
  await expect(page.getByLabel('Overlay name')).toHaveValue('New overlay');
  await expect(page.locator('[data-layer-row]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to overlays' }).click();
  await expect(page.locator('[data-overlay-card]').last()).toContainText('1080 × 1920');
});

test('saves, uses and deletes your own templates', async ({ page }) => {
  const card = page.locator('[data-overlay-card]').first();
  await card.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Save as template…' }).click();
  const save = page.getByRole('dialog', { name: 'Save as template' });
  await save.getByLabel('Template name').fill('My HUD');
  await save.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByText('Saved "My HUD"')).toBeVisible();

  const dlg = await openPicker(page);
  await expect(dlg.getByText('Your templates')).toBeVisible();
  await pick(dlg, 'My HUD');
  await dlg.getByLabel('Name', { exact: true }).fill('From mine');
  await dlg.getByRole('button', { name: 'Create overlay' }).click();
  await expect(page.getByLabel('Overlay name')).toHaveValue('From mine');
  const layers = await page.locator('[data-layer-row]').count();
  expect(layers).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Back to overlays' }).click();

  const again = await openPicker(page);
  await again.locator('.tpl', { has: page.getByRole('radio', { name: 'My HUD' }) }).hover();
  await again.getByRole('button', { name: 'Delete template My HUD' }).click();
  await expect(again.getByText('Your templates')).toHaveCount(0);
  await expect(again.getByRole('radio', { name: 'Blank', exact: true })).toBeChecked();
});
