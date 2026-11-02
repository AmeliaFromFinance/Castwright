import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubProviders } from '../providers';

const here = dirname(fileURLToPath(import.meta.url));
const screens = join(here, '__screens__');

let errors: string[] = [];

// The app runs on the shared server from playwright.config.ts.
const base = 'http://localhost:4317';

test.beforeAll(() => {
  mkdirSync(screens, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await stubProviders(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/?demo=static`, { timeout: 90_000 });
  await page.getByRole('button', { name: 'Overlays', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overlays' })).toBeVisible();
});

test.afterEach(() => {
  expect(errors, 'no page or console errors').toEqual([]);
});

const stageLayer = (page: Page, id: string) => page.locator(`.cw-stage [data-layer-id="${id}"]`);
const rows = (page: Page) => page.locator('[data-layer-row]');
const num = async (l: Locator) => Number(await l.inputValue());

async function selectedId(page: Page): Promise<string> {
  const id = await page.locator('[data-selected]').getAttribute('data-selected');
  expect(id).toBeTruthy();
  return id!;
}

async function createOverlay(page: Page, name: string, starter = false) {
  await page.getByRole('button', { name: 'New overlay' }).first().click();
  const dlg = page.getByRole('dialog', { name: 'New overlay' });
  await dlg.getByLabel('Name').fill(name);
  await dlg.getByText(starter ? 'Starter layout' : 'Empty', { exact: true }).click();
  await dlg.getByRole('button', { name: 'Create overlay' }).click();
  await expect(page.getByLabel('Overlay name')).toHaveValue(name);
}

async function waitSaved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /Saved|Saving|Not saved/ })).toHaveText(/Saved/, { timeout: 5000 });
}

async function dragBy(page: Page, target: Locator, dx: number, dy: number, opts: { modifiers?: Array<'Shift' | 'Control'> } = {}) {
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  for (const m of opts.modifiers ?? []) await page.keyboard.down(m);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
  for (const m of opts.modifiers ?? []) await page.keyboard.up(m);
}

test('lists overlays with previews and actions', async ({ page }) => {
  const card = page.locator('[data-overlay-card]').first();
  await expect(card).toContainText('Gameplay HUD');
  await expect(card).toContainText('1920 × 1080');
  await expect(card).toContainText('4 layers');
  await expect(card.locator('.cw-stage [data-layer-id]').first()).toBeAttached();

  await card.getByRole('button', { name: 'Add to OBS' }).click();
  const obs = page.getByRole('dialog', { name: 'Add to OBS' });
  await expect(obs.getByLabel('Scene')).toHaveValue('Gameplay');
  await obs.getByRole('button', { name: 'Add to scene' }).click();
  await expect(page.getByText('Added "Gameplay HUD" to Gameplay')).toBeVisible();

  // Import in the browser demo explains itself instead of failing silently.
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText('Importing files needs the desktop app.')).toBeVisible();

  await card.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(page.locator('[data-overlay-card]')).toHaveCount(2);
  await expect(page.locator('[data-overlay-card]').nth(1)).toContainText('Gameplay HUD copy');

  await page.locator('[data-overlay-card]').nth(1).getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete overlay' }).click();
  await expect(page.locator('[data-overlay-card]')).toHaveCount(1);

  // Let the toasts time out so the screenshot shows just the page.
  await expect(page.getByRole('button', { name: 'Dismiss' })).toHaveCount(0, { timeout: 10_000 });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(screens, 'overlays-list.png') });
});

test('creates an overlay and edits, moves, undoes, reorders and hides layers', async ({ page }) => {
  await createOverlay(page, 'E2E overlay');
  await expect(page.getByText('No layers yet')).toBeVisible();

  // Add a text layer and change its text.
  await page.getByRole('button', { name: 'Add text layer' }).click();
  const textId = await selectedId(page);
  const text = page.locator(`#p-${textId}-text`);
  await text.fill('Hello from e2e');
  await expect(stageLayer(page, textId)).toContainText('Hello from e2e');

  // Drag it on the canvas.
  const x = page.getByLabel('X position');
  const y = page.getByLabel('Y position');
  const x0 = await num(x);
  const y0 = await num(y);
  await dragBy(page, stageLayer(page, textId), 120, 70, { modifiers: ['Control'] });
  await expect.poll(() => num(x)).toBeGreaterThan(x0 + 100);
  expect(await num(y)).toBeGreaterThan(y0 + 50);

  // Undo puts it back in one step; the text edit stays.
  await page.keyboard.press('Control+z');
  await expect(x).toHaveValue(String(x0));
  await expect(y).toHaveValue(String(y0));
  await expect(stageLayer(page, textId)).toContainText('Hello from e2e');
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => num(x)).toBeGreaterThan(x0 + 100);

  // Arrow keys nudge the selection.
  await page.locator('.surface').focus();
  const xAfterDrag = await num(x);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(x).toHaveValue(String(xAfterDrag + 11));

  // Add a shape: it goes on top. Bring the text forward again.
  await page.getByRole('button', { name: 'Add shape layer' }).click();
  const shapeId = await selectedId(page);
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toHaveAttribute('data-layer-row', shapeId);
  await page.locator(`#layer-${textId}`).click();
  await page.getByRole('button', { name: 'Bring forward' }).click();
  await expect(rows(page).first()).toHaveAttribute('data-layer-row', textId);

  // And back by dragging in the list.
  await rows(page).nth(1).dragTo(rows(page).first(), { targetPosition: { x: 40, y: 4 } });
  await expect(rows(page).first()).toHaveAttribute('data-layer-row', shapeId);

  // Hide the shape: faded while "show hidden" is on, gone when it's off.
  await page.getByRole('button', { name: 'Hide Shape' }).click();
  await expect(stageLayer(page, shapeId)).toHaveClass(/cw-ghost/);
  await page.getByRole('button', { name: 'Show hidden layers' }).click();
  await expect(stageLayer(page, shapeId)).toHaveCount(0);
  await page.getByRole('button', { name: 'Show hidden layers' }).click();
  await page.getByRole('button', { name: 'Show Shape' }).click();
  await expect(stageLayer(page, shapeId)).not.toHaveClass(/cw-ghost/);

  // Rename inline.
  await page.locator(`#layer-${textId}`).dblclick();
  await page.locator(`#rename-${textId}`).fill('Headline');
  await page.keyboard.press('Enter');
  await expect(page.locator(`#layer-${textId}`)).toHaveText('Headline');

  await waitSaved(page);
  await page.locator(`#layer-${textId}`).click();
  await page.screenshot({ path: join(screens, 'editor-text.png') });

  // Back to the list: the saved overlay is there with both layers.
  await page.getByRole('button', { name: 'Back to overlays' }).click();
  const card = page.locator('[data-overlay-card]').filter({ hasText: 'E2E overlay' });
  await expect(card).toContainText('2 layers');

  // Reopen: everything came back from the backend.
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(rows(page).nth(1)).toContainText('Headline');
  await page.locator(`#layer-${textId}`).click();
  await expect(page.locator(`#p-${textId}-text`)).toHaveValue('Hello from e2e');
  await expect(x).toHaveValue(String(xAfterDrag + 11));
});

test('keyboard shortcuts, resizing and saving on the way out', async ({ page }) => {
  await createOverlay(page, 'Keys', true);
  await expect(rows(page)).toHaveCount(5);

  await page.locator('#layer-' + (await rows(page).filter({ hasText: 'Sub goal' }).getAttribute('data-layer-row'))).click();
  const id = await selectedId(page);
  const w = page.getByLabel('Width', { exact: true });
  const h = page.getByLabel('Height', { exact: true });
  const w0 = await num(w);
  const h0 = await num(h);

  // Shift keeps the aspect ratio while resizing from a corner.
  await dragBy(page, page.locator('[data-handle="se"]'), 80, 10, { modifiers: ['Shift'] });
  await expect.poll(() => num(w)).toBeGreaterThan(w0);
  const ratio = (await num(w)) / (await num(h));
  expect(Math.abs(ratio - w0 / h0)).toBeLessThan(0.05);

  // Typing in a field never triggers canvas shortcuts.
  const name = page.getByLabel('Layer name').first();
  await name.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await expect(rows(page)).toHaveCount(5);

  // Ctrl+D duplicates, Delete removes, Escape deselects.
  await page.locator('.surface').focus();
  await page.keyboard.press('Control+d');
  await expect(rows(page)).toHaveCount(6);
  const copy = await selectedId(page);
  expect(copy).not.toBe(id);
  await page.keyboard.press('Delete');
  await expect(rows(page)).toHaveCount(5);
  await page.locator(`#layer-${id}`).click();
  await page.locator('.surface').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-selected]')).toHaveCount(0);
  await expect(page.getByText('Shortcuts')).toBeVisible();

  // Locked layers can't be dragged.
  await page.locator(`#layer-${id}`).click();
  await page.getByRole('button', { name: 'Lock layer' }).click();
  const x = page.getByLabel('X position');
  const x0 = await num(x);
  await dragBy(page, stageLayer(page, id), 100, 0);
  await expect(x).toHaveValue(String(x0));

  // Leaving through the side bar saves pending changes.
  await page.getByLabel('Overlay name').fill('Keys renamed');
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await page.getByRole('button', { name: 'Overlays', exact: true }).click();
  // The editor reopens where it was, loaded fresh from the backend.
  await expect(page.getByLabel('Overlay name')).toHaveValue('Keys renamed');
  await page.getByRole('button', { name: 'Back to overlays' }).click();
  await expect(page.locator('[data-overlay-card]').filter({ hasText: 'Keys renamed' })).toBeVisible();
});

test('custom widget code tabs and generated settings', async ({ page }) => {
  await createOverlay(page, 'Widget');
  await page.getByRole('button', { name: 'Add custom widget layer' }).click();
  const id = await selectedId(page);
  const tabs = page.getByRole('tablist', { name: 'Widget code' });
  for (const t of ['HTML', 'CSS', 'JS', 'Fields']) {
    await tabs.getByRole('tab', { name: t }).click();
    await expect(tabs.getByRole('tab', { name: t })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.cm-content').first()).toBeVisible();
  }
  await expect(page.locator('.cm-content').first()).toContainText('"colorpicker"');

  // The widget renders its default field value.
  const frame = page.frameLocator(`.cw-stage [data-layer-id="${id}"] iframe`);
  await expect(frame.locator('#message')).toHaveText('Thanks for watching!');

  // Invalid JSON shows a clear error and keeps the last good fields.
  const code = page.locator('.cm-content').first();
  await code.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('{\n  "message": { "type": "text", "label": "Message" \n}');
  await expect(page.getByRole('alert')).toContainText(/Line \d+, column \d+/);
  await expect(page.getByLabel('Message', { exact: true })).toBeVisible();

  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(
    JSON.stringify({
      message: { type: 'text', label: 'Message', value: 'Hi' },
      size: { type: 'slider', label: 'Size', value: 20, min: 10, max: 60 },
      bold: { type: 'checkbox', label: 'Bold', value: false },
      mode: { type: 'dropdown', label: 'Mode', value: 'a', options: { a: 'First', b: 'Second' } }
    })
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('Size', { exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Bold' })).toBeVisible();
  await expect(page.getByLabel('Mode', { exact: true })).toHaveValue('a');

  await page.getByLabel('Message', { exact: true }).fill('Live from e2e');
  await expect(frame.locator('#message')).toHaveText('Live from e2e');

  await tabs.getByRole('tab', { name: 'HTML' }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(screens, 'editor-widget.png') });
});

test('test menu plays a sample alert and preview values', async ({ page }) => {
  await page.locator('[data-overlay-card]').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByLabel('Overlay name')).toHaveValue('Gameplay HUD');

  await page.getByRole('button', { name: 'Test' }).click();
  await page.getByLabel('Play an alert').selectOption('sub');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.cw-stage [data-alert-id]')).toBeVisible();
  await expect(page.locator('.cw-stage [data-alert-id]')).toHaveAttribute('data-kind', 'sub');

  // The test panel stays open for repeated tries.
  await page.getByRole('button', { name: 'Preview values…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Preview values' });
  await dlg.getByRole('button', { name: 'Sub goal at 75%' }).click();
  await expect(dlg.getByLabel('Value')).toHaveValue('15');
  await dlg.getByRole('button', { name: 'Done' }).click();
  const goal = page.locator('.cw-stage .cw-type-goal');
  await expect(goal).toContainText('15');

  await page.waitForTimeout(500);
  await page.screenshot({ path: join(screens, 'editor-alert.png') });

  // Animation preview runs without errors.
  await page.locator('[data-layer-row]').filter({ hasText: 'Sub goal' }).locator('.pick').click();
  await page.getByRole('button', { name: /^Animation/ }).click();
  await page.getByRole('button', { name: 'Preview enter animation' }).click();
  await page.waitForTimeout(700);
});
