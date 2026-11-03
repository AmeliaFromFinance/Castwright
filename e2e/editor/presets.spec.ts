import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubProviders } from '../providers';

const BOX_PRESETS = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/lib/overlay/box-presets.json'), 'utf8')) as Array<{ id: string }>;

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || (m.type() === 'warning' && m.text().includes('[svelte]'))) errors.push(`console: ${m.text()}`);
  });
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await stubProviders(page);
  await page.goto('/?demo=static', { timeout: 90_000 });
});

test.afterEach(() => {
  expect(errors, 'no page or console errors').toEqual([]);
});

const canvas = (page: Page) => page.locator('.cw-stage').first();
const fontSize = (l: Locator) => l.evaluate((el) => getComputedStyle(el).fontSize);

async function openEditor(page: Page) {
  await page.getByRole('button', { name: 'Overlays', exact: true }).click();
  await page.locator('[data-overlay-card]').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByLabel('Overlay name')).toHaveValue('Gameplay HUD');
}

async function clickEveryPreset(gallery: Locator, check: () => Promise<void>) {
  for (const p of [...BOX_PRESETS, ...BOX_PRESETS.slice().reverse()]) {
    await gallery.locator(`[data-preset="${p.id}"]`).click();
    await check();
  }
}

test('clicking through styles keeps the font size on chat, events and polls', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Add poll / prediction layer' }).click();
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await page.getByRole('button', { name: 'Follow', exact: true }).click();
  await page.getByRole('button', { name: 'Chat message', exact: true }).click();
  await page.keyboard.press('Escape');

  const layers: Array<[string, string]> = [
    ['Chat', '.cw-type-chat .cw-chat-line'],
    ['Recent events', '.cw-type-event_list .cw-event-row .cw-text'],
    ['Poll', '.cw-type-poll .cw-poll-label']
  ];
  for (const [name, target] of layers) {
    await page.locator('[data-layer-row]').filter({ hasText: name }).first().locator('.pick').click();
    const size = page.getByLabel('Font size').first();
    if (!(await size.isVisible())) await page.getByRole('button', { name: 'Text style', exact: true }).first().click();
    await size.fill('40');
    const text = canvas(page).locator(target).first();
    await expect.poll(() => fontSize(text), { message: name }).toBe('40px');

    const cards = page.getByRole('button', { name: /^Cards/ });
    if ((await cards.getAttribute('aria-expanded')) !== 'true') await cards.click();
    const gallery = page.getByRole('list', { name: 'Styles' }).first();
    await clickEveryPreset(gallery, async () => {
      await expect.poll(() => fontSize(text), { message: name }).toBe('40px');
    });
    await expect(size).toHaveValue('40');
  }
});

test('clicking through styles keeps the alert title size', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Alerts' }).click();
  await page.getByRole('button', { name: /^Follow/ }).click();
  const card = page.locator('[data-variation]').first();
  await card.locator('button.expand').click();
  const title = page.getByRole('region', { name: 'Preview' }).locator('.cw-alert-title');
  await expect(title).toBeVisible();
  const before = await fontSize(title);
  await card.getByRole('button', { name: 'Styles', exact: true }).click();
  await clickEveryPreset(card.getByRole('list', { name: 'Styles' }), async () => {
    await expect.poll(() => fontSize(title)).toBe(before);
  });
});
