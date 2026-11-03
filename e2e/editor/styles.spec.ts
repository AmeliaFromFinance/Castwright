import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubProviders } from '../providers';

const here = dirname(fileURLToPath(import.meta.url));
const screens = join(here, '__screens__');

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
  await page.setViewportSize({ width: 1920, height: 1080 });
  await stubProviders(page);
  await page.goto('/?demo=static', { timeout: 90_000 });
});

test.afterEach(() => {
  expect(errors, 'no page or console errors').toEqual([]);
});

/** The editor canvas comes before any preview in the page. */
const canvas = (page: Page) => page.locator('.cw-stage').first();

async function openEditor(page: Page) {
  await page.getByRole('button', { name: 'Overlays', exact: true }).click();
  await page.locator('[data-overlay-card]').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByLabel('Overlay name')).toHaveValue('Gameplay HUD');
}

async function selectLayer(page: Page, name: string) {
  await page.locator('[data-layer-row]').filter({ hasText: name }).locator('.pick').click();
}

const style = (l: Locator, prop: string, pseudo?: string) =>
  l.evaluate((el, [p, ps]) => getComputedStyle(el, ps || null).getPropertyValue(p!), [prop, pseudo ?? ''] as const);

test('style presets restyle chat cards, and the default look stays as it was', async ({ page }) => {
  await openEditor(page);
  const goalBox = canvas(page).locator('.cw-type-goal .cw-box');
  const before = await goalBox.evaluate((el) => {
    const s = getComputedStyle(el);
    return [s.backgroundColor, s.borderTopWidth, s.borderTopColor, s.borderRadius, s.padding, s.boxShadow, s.backdropFilter];
  });
  expect(before).toEqual([
    'rgba(12, 15, 22, 0.78)',
    '1px',
    'rgba(255, 255, 255, 0.08)',
    '12px',
    '16px',
    'rgba(0, 0, 0, 0.35) 0px 12px 40px 0px',
    'blur(10px)'
  ]);
  const line = canvas(page).locator('.cw-type-chat .cw-chat-line').last();
  expect(await style(line, 'background-image')).toBe('none');
  await page.screenshot({ path: join(screens, 'styles-default.png') });

  await selectLayer(page, 'Chat');
  await page.getByRole('button', { name: /^Cards/ }).click();
  const gallery = page.getByRole('list', { name: 'Styles' }).first();
  await expect(gallery.getByRole('button', { name: /^Comic style/ })).toBeVisible();
  // Previews use the real renderer.
  await expect(gallery.locator('[data-preset="comic"] .cw-chat-line').first()).toBeVisible();

  await gallery.getByRole('button', { name: /^Comic style/ }).click();
  await expect.poll(() => style(line, 'border-top-width')).toBe('4px');
  expect(await style(line, 'background-image')).toContain('radial-gradient');
  expect(await style(line, 'background-color')).toBe('rgb(255, 255, 255)');
  expect(await style(line, 'filter')).toContain('drop-shadow');
  expect(await style(line, 'transform')).not.toBe('none');
  // The speech tail is a pseudo-element with the same fill and border.
  expect(await style(line, 'content', '::after')).toBe('""');
  expect(await style(line, 'background-color', '::after')).toBe('rgb(255, 255, 255)');
  expect(await style(line, 'border-bottom-width', '::after')).toBe('4px');
  expect(await style(canvas(page).locator('.cw-type-chat .cw-chat'), 'font-family')).toContain('Bangers');
  await expect(page.getByLabel('Font', { exact: true }).first()).toHaveValue('Bangers');
  // Every other card leans the other way.
  const leans = await canvas(page)
    .locator('.cw-type-chat .cw-chat-line')
    .evaluateAll((els) => els.slice(-4).map((e) => getComputedStyle(e).getPropertyValue('--cw-lean').trim()));
  expect(new Set(leans)).toEqual(new Set(['1', '-1']));

  // Other layers keep their look.
  expect(await goalBox.evaluate((el) => getComputedStyle(el).boxShadow)).toBe(before[5]);

  // Fields stay editable after picking.
  await page.getByRole('button', { name: 'Border and stripe' }).first().click();
  await page.getByLabel('Border width').first().fill('6');
  await expect.poll(() => style(line, 'border-top-width')).toBe('6px');
  await page.waitForTimeout(400);
  await canvas(page).locator('.cw-type-chat').screenshot({ path: join(screens, 'styles-chat-comic.png') });
  await page.screenshot({ path: join(screens, 'styles-editor-comic.png') });

  for (const id of ['speech', 'neon', 'pixel']) {
    await gallery.locator(`[data-preset="${id}"]`).click();
    await page.waitForTimeout(300);
    await canvas(page).locator('.cw-type-chat').screenshot({ path: join(screens, `styles-chat-${id}.png`) });
  }
  // Cut and pixel shapes draw border and fill on clipped layers.
  expect(await style(line, 'clip-path', '::after')).toContain('polygon');
  expect(await style(line, 'clip-path', '::before')).toContain('evenodd');
});

test('the comic preset on an alert shows in the alerts preview and the editor', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Alerts' }).click();
  await page.getByRole('button', { name: /^Follow/ }).click();
  const card = page.locator('[data-variation]').first();
  await card.locator('button.expand').click();
  await card.getByRole('button', { name: 'Styles', exact: true }).click();
  await card.getByRole('button', { name: /^Comic style/ }).click();
  await expect(card.getByRole('button', { name: 'Back to classic card' })).toBeVisible();

  const preview = page.getByRole('region', { name: 'Preview' }).locator('.cw-alert');
  await expect.poll(() => style(preview, 'background-color')).toBe('rgb(255, 217, 59)');
  expect(await style(preview, 'border-top-width')).toBe('4px');
  expect(await style(preview, 'filter')).toContain('drop-shadow');
  expect(await style(preview, 'content', '::after')).toBe('""');
  expect(await style(page.getByRole('region', { name: 'Preview' }).locator('.cw-alert-wrap'), 'transform')).not.toBe('none');
  await page.getByRole('region', { name: 'Preview' }).screenshot({ path: join(screens, 'styles-alert-preview.png') });
  await page.screenshot({ path: join(screens, 'styles-alerts-page.png') });

  // Back to the classic card.
  await card.getByRole('button', { name: 'Back to classic card' }).click();
  await expect.poll(() => style(preview, 'border-radius')).toBe('20px');
  expect(await style(preview, 'border-top-width')).toBe('0px');
  await card.getByRole('button', { name: /^Comic style/ }).click();

  await openEditor(page);
  await page.getByRole('button', { name: 'Test' }).click();
  await page.getByLabel('Play an alert').selectOption('follow');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.keyboard.press('Escape');
  const alert = canvas(page).locator('.cw-alert');
  await expect(alert).toBeVisible();
  await expect.poll(() => style(alert, 'background-color')).toBe('rgb(255, 217, 59)');
  expect(await style(alert, 'background-image')).toContain('radial-gradient');
  await page.waitForTimeout(900);
  await canvas(page).locator('.cw-type-alerts').screenshot({ path: join(screens, 'styles-alert-editor.png') });
});

test('custom CSS lists selectors, inserts rules and completes them', async ({ page }) => {
  await openEditor(page);
  await selectLayer(page, 'Chat');
  await page.getByRole('button', { name: /^Advanced/ }).click();
  await page.getByRole('button', { name: /What you can target/ }).click();
  const list = page.getByRole('list', { name: 'Selectors' });
  await expect(list).toContainText('.cw-chat-line');
  await expect(list).toContainText('Each message card');
  await expect(list).not.toContainText('.cw-alert');
  await expect(page.getByRole('list', { name: 'Variables' })).toContainText('--cw-name');

  await list.getByRole('button', { name: /\.cw-chat-name/ }).click();
  const editor = page.getByRole('textbox', { name: 'Custom CSS' });
  await expect(editor).toContainText('.cw-chat-name {');
  await page.keyboard.type('text-transform: uppercase;');
  await expect.poll(() => style(canvas(page).locator('.cw-chat-name').last(), 'text-transform')).toBe('uppercase');

  await editor.press('Control+End');
  await page.keyboard.type('\n.cw-chat-li');
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('.cw-chat-line');
  await page.keyboard.press('Escape');
});

test('side columns resize and remember their width', async ({ page }) => {
  await openEditor(page);
  const props = page.getByRole('complementary', { name: 'Properties' });
  const w0 = (await props.boundingBox())!.width;
  const handle = page.getByRole('separator', { name: 'Resize properties panel' });
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => Math.round((await props.boundingBox())!.width)).toBe(Math.round(w0 + 32));
  const box = (await page.getByRole('separator', { name: 'Resize layers panel' }).boundingBox())!;
  await page.mouse.move(box.x + 1, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 61, box.y + 200, { steps: 4 });
  await page.mouse.up();
  await page.reload();
  await openEditor(page);
  await expect.poll(async () => Math.round((await props.boundingBox())!.width)).toBe(Math.round(w0 + 32));

  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Alerts' }).click();
  const side = page.getByRole('complementary', { name: 'Preview and queue' });
  const s0 = (await side.boundingBox())!.width;
  await page.getByRole('separator', { name: 'Resize preview panel' }).focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(async () => Math.round((await side.boundingBox())!.width)).toBe(Math.round(s0 + 64));
});

test('the default font reaches text set to Default', async ({ page }) => {
  await openEditor(page);
  await selectLayer(page, 'Chat');
  const chat = canvas(page).locator('.cw-type-chat .cw-chat');
  // The starter project names Inter; switch the chat layer to Default.
  await expect(page.getByLabel('Font', { exact: true }).first()).toHaveValue('Inter');
  await page.getByRole('button', { name: 'Use the default font' }).first().click();
  await expect(page.getByLabel('Font', { exact: true }).first()).toHaveValue('Default');
  await expect.poll(() => style(chat, 'font-family')).toMatch(/^"?Inter"?,/);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Appearance' }).click();
  const font = page.getByRole('combobox', { name: 'Default font' });
  await expect(font).toHaveValue('Inter');
  await font.fill('Bangers');
  await font.press('Tab');

  // Back to the editor, still open.
  await page.getByRole('button', { name: 'Overlays', exact: true }).click();
  await expect(page.getByLabel('Overlay name')).toHaveValue('Gameplay HUD');
  await expect.poll(() => style(chat, 'font-family')).toMatch(/^"?Bangers"?,/);
  // Layers that name a font keep it.
  expect(await style(canvas(page).locator('.cw-type-goal').first(), 'font-family')).not.toContain('Bangers');
});
