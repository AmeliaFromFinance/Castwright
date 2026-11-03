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
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await stubProviders(page);
  await page.goto('/?demo=static', { timeout: 90_000 });
});

test.afterEach(() => {
  expect(errors, 'no page or console errors').toEqual([]);
});

async function center(l: Locator) {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + (to.x - from.x) / 3, from.y + (to.y - from.y) / 3, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

const pos = async (l: Locator) => [Number(await l.getAttribute('data-x')), Number(await l.getAttribute('data-y'))];

test('scene rule on a layer, and preview as scene', async ({ page }) => {
  await page.getByRole('button', { name: 'Overlays', exact: true }).click();
  await page.getByRole('button', { name: 'New overlay' }).first().click();
  const dlg = page.getByRole('dialog', { name: 'New overlay' });
  await dlg.getByLabel('Name', { exact: true }).fill('Scenes test');
  await dlg.locator('label', { has: page.getByRole('radio', { name: 'Gameplay', exact: true }) }).click();
  await dlg.getByRole('button', { name: 'Create overlay' }).click();
  await expect(page.getByLabel('Overlay name')).toHaveValue('Scenes test');

  const row = page.locator('[data-layer-row]').filter({ has: page.locator('.name', { hasText: /^Chat$/ }) });
  const id = (await row.getAttribute('data-layer-row'))!;
  await row.locator('button.pick').click();
  const props = page.getByRole('complementary', { name: 'Properties' });
  await props.getByRole('button', { name: 'Scenes' }).click();
  await props.getByLabel('Show', { exact: true }).selectOption('only');
  // OBS lists its scenes; tick one, and type one that OBS doesn't have.
  await props.getByRole('checkbox', { name: 'Gameplay' }).check();
  await props.getByLabel('Scene name').fill('Old scene');
  await props.getByLabel('Scene name').press('Enter');
  await expect(props.getByRole('checkbox', { name: 'Old scene' })).toBeChecked();
  await expect(row.locator('[data-scene-badge]')).toHaveAttribute('title', 'Only 2 scenes');
  // A second layer that BRB hides.
  const goal = page.locator('[data-layer-row]').filter({ has: page.locator('.name', { hasText: /^Sub goal$/ }) });
  await goal.locator('button.pick').click();
  await props.getByLabel('Show', { exact: true }).selectOption('hide');
  await props.getByRole('checkbox', { name: 'BRB' }).check();
  await row.locator('button.pick').click();

  const layer = page.locator(`.cw-stage [data-layer-id="${id}"]`);
  const preview = page.getByLabel('Preview as scene');
  await expect(layer).not.toHaveClass(/cw-ghost/);
  await preview.selectOption('BRB');
  await expect(layer).toHaveClass(/cw-ghost/);
  await expect(row).toHaveClass(/scene-off/);
  // Dimmed, not removed: still selectable and editable on the canvas.
  await layer.click({ force: true });
  await expect(page.locator('[data-selected]')).toHaveAttribute('data-selected', id);
  await page.screenshot({ path: join(screens, 'editor-preview-as-scene.png') });

  await preview.selectOption('Gameplay');
  await expect(layer).not.toHaveClass(/cw-ghost/);
  await preview.selectOption('');
  await expect(layer).not.toHaveClass(/cw-ghost/);

  // Hide in: the other way round.
  await props.getByLabel('Show', { exact: true }).selectOption('hide');
  await preview.selectOption('Gameplay');
  await expect(layer).toHaveClass(/cw-ghost/);
  await expect(page.getByRole('status').filter({ hasText: /Saved|Saving/ })).toHaveText(/Saved/, { timeout: 5000 });
});

test('notes and frames on the automation canvas', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Automation' }).click();
  await page.getByRole('navigation', { name: 'Actions' }).getByRole('button', { name: /^Count deaths/ }).click();
  const canvas = page.getByRole('region', { name: 'Flow of Count deaths' });
  await expect(canvas).toBeVisible();
  const nodes = page.locator('[data-node-wrap]');
  const count = await nodes.count();
  expect(count).toBeGreaterThanOrEqual(3);

  // A note from the bottom bar opens for typing.
  await page.getByRole('button', { name: 'Add note' }).click();
  const area = page.getByLabel('Note text');
  await area.fill('**Deaths** go up by one.\n- reset with *!resetdeaths*\n- see [docs](https://castwright.sinist3r.lol)');
  await area.press('Escape');
  const note = page.locator('[data-note]').first();
  await expect(note.locator('strong')).toHaveText('Deaths');
  await expect(note.locator('li')).toHaveCount(2);
  await expect(note.locator('a')).toHaveAttribute('href', 'https://castwright.sinist3r.lol');

  // A second note with Shift + double-click, in a new colour.
  const empty = await canvas.boundingBox();
  await page.keyboard.down('Shift');
  await page.mouse.dblclick(empty!.x + 120, empty!.y + empty!.height - 200);
  await page.keyboard.up('Shift');
  await page.getByLabel('Note text').fill('Ask mods first');
  await page.getByLabel('Note text').press('Escape');
  await expect(page.locator('[data-note]')).toHaveCount(2);
  await page.locator('[data-note]').nth(1).getByRole('radio', { name: 'Green' }).click();
  await expect(page.locator('[data-note]').nth(1)).toHaveAttribute('style', /#3fae78/);

  // Group the trigger and the first step.
  const first = nodes.nth(0);
  const second = nodes.nth(1);
  const firstId = (await first.getAttribute('data-node-wrap'))!;
  const secondId = (await second.getAttribute('data-node-wrap'))!;
  await first.locator('[data-node]').click();
  await second.locator('[data-node]').click({ modifiers: ['Shift'] });
  await page.keyboard.press('Control+g');
  const frame = page.locator('[data-frame]');
  await expect(frame).toHaveCount(1);

  // Rename it.
  await frame.locator('.label').dblclick();
  await page.getByLabel('Frame name').fill('Start');
  await page.getByLabel('Frame name').press('Enter');
  await expect(frame.locator('.label')).toHaveText('Start');

  // Dragging the title bar moves the nodes inside, not the others.
  const third = nodes.nth(2);
  const before = [await pos(first), await pos(second), await pos(third), await pos(frame)];
  const bar = frame.locator('[data-item]');
  const at = await center(frame.locator('.label'));
  await drag(page, at, { x: at.x - 160, y: at.y + 64 });
  const after = [await pos(first), await pos(second), await pos(third), await pos(frame)];
  const dx = after[3]![0]! - before[3]![0]!;
  const dy = after[3]![1]! - before[3]![1]!;
  expect(dx).toBeLessThan(0);
  expect(dy).toBeGreaterThan(0);
  expect(after[0]).toEqual([before[0]![0]! + dx, before[0]![1]! + dy]);
  expect(after[1]).toEqual([before[1]![0]! + dx, before[1]![1]! + dy]);
  expect(after[2]).toEqual(before[2]);

  // Drag a node out: it leaves the frame.
  const card = page.locator(`[data-node-wrap="${secondId}"] [data-node]`);
  const c = await center(card);
  const fb = (await frame.boundingBox())!;
  await drag(page, c, { x: fb.x + fb.width + 260, y: c.y });
  await page.keyboard.press('f');
  await page.getByRole('button', { name: 'Collapse Start' }).click();
  await expect(page.locator(`[data-node-wrap="${firstId}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-node-wrap="${secondId}"]`)).toHaveCount(1);
  await expect(frame).toHaveAttribute('data-collapsed', 'true');
  await expect(frame.locator('.count')).toHaveText('1 node');
  // The line from the hidden trigger now starts at the collapsed frame.
  await expect(page.locator(`[data-edge][data-from="${firstId}"]`)).toHaveCount(1);
  await page.getByRole('button', { name: 'Expand Start' }).click();
  await expect(page.locator(`[data-node-wrap="${firstId}"]`)).toHaveCount(1);

  // Undo brings back the collapse, then redo; Tidy up keeps the frame around its node.
  await page.keyboard.press('Control+z');
  await expect(frame).toHaveAttribute('data-collapsed', 'true');
  await page.keyboard.press('Control+Shift+z');
  await expect(frame).toHaveAttribute('data-collapsed', 'false');
  await page.getByRole('button', { name: 'Tidy up' }).click();
  const fr = (await frame.boundingBox())!;
  const nr = (await page.locator(`[data-node-wrap="${firstId}"]`).boundingBox())!;
  expect(nr.x).toBeGreaterThan(fr.x);
  expect(nr.y + nr.height).toBeLessThan(fr.y + fr.height);

  // Put the notes beside the flow for the screenshot, holding them by their top-left corner.
  const notes = page.locator('[data-note]');
  const grab = async (n: Locator) => {
    const b = (await n.boundingBox())!;
    return { x: b.x + 16, y: b.y + 10 };
  };
  const frameBox = (await frame.boundingBox())!;
  await drag(page, await grab(notes.nth(0)), { x: frameBox.x + frameBox.width + 60, y: frameBox.y + 20 });
  const send = (await page.locator('[data-node-wrap]').last().boundingBox())!;
  await drag(page, await grab(notes.nth(1)), { x: send.x + send.width + 60, y: send.y });
  await page.getByRole('button', { name: 'Fit to view (F)' }).click();
  const cb = (await canvas.boundingBox())!;
  await page.mouse.click(cb.x + 12, cb.y + 12);
  await expect(page.locator('[data-note] .tools')).toHaveCount(0);
  await expect(page.getByText('Grouped.')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByRole('status').filter({ hasText: /Saved|Saving/ }).first()).toHaveText(/Saved/, { timeout: 5000 });
  await page.screenshot({ path: join(screens, 'automation-notes-frames.png') });

  // Ungroup keeps the nodes.
  await bar.click();
  await page.keyboard.press('Control+Shift+g');
  await expect(frame).toHaveCount(0);
  await expect(nodes).toHaveCount(count);
});
