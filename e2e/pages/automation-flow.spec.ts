import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubProviders } from '../providers';

const screens = join(dirname(fileURLToPath(import.meta.url)), '__screens__');

test.beforeAll(() => {
  mkdirSync(screens, { recursive: true });
});

async function open(page: Page, width = 1440, height = 900): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || (m.type() === 'warning' && m.text().includes('[svelte]'))) errors.push(`console: ${m.text()}`);
  });
  await page.setViewportSize({ width, height });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await stubProviders(page);
  await page.goto('/?demo=static');
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Automation' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Automation' })).toBeVisible();
  return errors;
}

/** The positioned wrapper of the node whose card contains `text`. */
const node = (page: Page, text: string | RegExp): Locator =>
  page.locator('[data-node-wrap]').filter({ has: page.locator('[data-node]', { hasText: text }) });
const card = (page: Page, text: string | RegExp) => node(page, text).locator('[data-node]');
/** The If node (its title is just "If"). */
const ifNode = (page: Page): Locator => page.locator('[data-node-wrap]').filter({ has: page.locator('.title', { hasText: /^If$/ }) });
const idOf = async (n: Locator) => (await n.getAttribute('data-node-wrap'))!;
const pos = async (n: Locator) => [Number(await n.getAttribute('data-x')), Number(await n.getAttribute('data-y'))];

async function center(l: Locator) {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Screen point part way along a line. */
async function alongEdge(edge: Locator, t: number) {
  return edge.locator('.line').evaluate((el, t) => {
    const p = el as SVGPathElement;
    const pt = p.getPointAtLength(p.getTotalLength() * t);
    const m = p.getScreenCTM()!;
    return { x: pt.x * m.a + pt.y * m.c + m.e, y: pt.x * m.b + pt.y * m.d + m.f };
  }, t);
}

/** Drag with the mouse from one point to another in small steps. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + (to.x - from.x) / 3, from.y + (to.y - from.y) / 3, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

/** Draw a line from a side of one node to a side of another (or to a point). */
async function connect(page: Page, from: Locator, side: string, to: Locator | { x: number; y: number }, toSide = 'left') {
  await from.hover();
  const a = await center(from.locator(`[data-handle="${side}"]`));
  let b: { x: number; y: number };
  if ('locator' in to) {
    await to.hover();
    b = await center(to.locator(`[data-handle="${toSide}"]`));
    await from.hover();
  } else b = to;
  await drag(page, a, b);
}

test('automation flow: free canvas editing, undo, tidy, test', async ({ page }) => {
  const errors = await open(page);
  const list = page.getByRole('navigation', { name: 'Actions' });
  await list.getByRole('button', { name: /^Count deaths/ }).click();

  const canvas = page.getByRole('region', { name: 'Flow of Count deaths' });
  await expect(canvas).toBeVisible();
  await expect(card(page, '!death')).toContainText('Start');
  await expect(card(page, 'counter.deaths + 1')).toBeVisible();
  await expect(canvas.locator('[data-edge]')).toHaveCount(2);
  // The List view is gone; the flow is the only editor.
  await expect(page.getByRole('radio', { name: 'List' })).toHaveCount(0);

  // Drag a node somewhere else; the spot is kept after switching actions.
  const chat = node(page, 'Send chat message');
  const [x0, y0] = await pos(chat);
  const c0 = await center(card(page, 'Send chat message').locator('.title'));
  await drag(page, c0, { x: c0.x + 260, y: c0.y + 40 });
  const [x1, y1] = await pos(chat);
  expect(x1 - x0).toBeGreaterThan(200);
  expect(y1 - y0).toBeGreaterThan(20);
  expect(x1 % 16).toBe(0);
  await list.getByRole('button', { name: /^!so/ }).click();
  await expect(page.getByRole('region', { name: 'Flow of !so' })).toBeVisible();
  await list.getByRole('button', { name: /^Count deaths/ }).click();
  expect(await pos(node(page, 'Send chat message'))).toEqual([x1, y1]);

  // A whole drag is one undo step.
  await card(page, 'Send chat message').focus();
  await page.keyboard.press('Control+z');
  await expect.poll(() => pos(node(page, 'Send chat message'))).toEqual([x0, y0]);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => pos(node(page, 'Send chat message'))).toEqual([x1, y1]);

  // Arrow keys nudge the selection; Shift moves a grid step.
  await page.mouse.click((await center(card(page, 'Send chat message').locator('.title'))).x, (await center(card(page, 'Send chat message').locator('.title'))).y);
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(() => pos(node(page, 'Send chat message'))).toEqual([x1 + 1, y1 + 16]);
  await page.keyboard.press('Control+z');
  await expect.poll(() => pos(node(page, 'Send chat message'))).toEqual([x1, y1]);

  // Copy and paste where the pointer is, then undo.
  const nodes = canvas.locator('[data-node]');
  await page.keyboard.press('Control+c');
  const cb = (await canvas.boundingBox())!;
  await page.mouse.move(cb.x + 80, cb.y + 80);
  await page.keyboard.press('Control+v');
  await expect(nodes).toHaveCount(4);
  await expect(card(page, 'Send chat message')).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(nodes).toHaveCount(3);

  // Double-click empty canvas to add a node right there.
  const box = (await canvas.boundingBox())!;
  const spot = { x: box.x + 200, y: box.y + box.height - 240 };
  await page.mouse.dblclick(spot.x, spot.y);
  const picker = page.getByRole('dialog', { name: 'Add a step' });
  await picker.getByRole('textbox').fill('log');
  await picker.getByRole('option', { name: /^Log/ }).click();
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await inspector.getByRole('textbox', { name: 'Text', exact: true }).fill('Another one');
  const log = node(page, 'Another one');
  await expect(log).toBeVisible();
  await expect(log).toContainText('Not connected');
  await expect(page.getByText(/1 warning/)).toBeVisible();
  await inspector.getByRole('button', { name: 'Close inspector (Esc)' }).click();
  await expect(inspector).toBeHidden();

  // Right side of one node to the left side of another, then a second line into the same side.
  const logId = await idOf(log);
  const add = node(page, 'counter.deaths + 1');
  await connect(page, add, 'right', log, 'left');
  const intoLog = canvas.locator(`[data-edge][data-to="${logId}"][data-to-side="left"]`);
  await expect(intoLog).toHaveCount(1);
  await expect(log).not.toContainText('Not connected');
  await connect(page, node(page, '!death'), 'right', log, 'left');
  await expect(intoLog).toHaveCount(2);
  // The same line again is ignored.
  await connect(page, add, 'right', log, 'left');
  await expect(intoLog).toHaveCount(2);

  // Drop a line on empty canvas: the picker adds a node that is already connected.
  await page.getByRole('button', { name: 'Fit to view (F)' }).click();
  const chatNow = node(page, 'Send chat message');
  await page.waitForTimeout(100);
  await chatNow.hover();
  const below = await center(chatNow.locator('[data-handle="bottom"]'));
  await drag(page, below, { x: below.x, y: below.y + 110 });
  await picker.getByRole('textbox').fill('if');
  await picker.getByRole('option', { name: /^If/ }).click();
  const iff = ifNode(page);
  await expect(iff).toBeVisible();
  const iffId = await idOf(iff);
  await expect(canvas.locator(`[data-edge][data-to="${iffId}"][data-to-side="top"]`)).toHaveCount(1);
  await page.keyboard.press('Escape');

  // Lines from an If start as Then; the label switches them.
  await connect(page, iff, 'left', log, 'right');
  const branch = canvas.locator(`[data-edge][data-from="${iffId}"]`);
  await expect(branch).toHaveAttribute('data-branch', 'then');
  await canvas.getByRole('button', { name: 'Then', exact: true }).click();
  await expect(branch).toHaveAttribute('data-branch', 'otherwise');
  await expect(canvas.getByRole('button', { name: 'Otherwise', exact: true })).toBeVisible();

  // Select a line and delete it; undo and redo.
  const lines = canvas.locator('[data-edge]');
  const before = await lines.count();
  const first = canvas.locator(`[data-edge][data-from="${await idOf(node(page, '!death'))}"][data-to="${await idOf(add)}"]`);
  const hp = await alongEdge(first, 0.3);
  await page.mouse.click(hp.x, hp.y);
  await expect(first).toHaveClass(/selected/);
  await page.keyboard.press('Delete');
  await expect(lines).toHaveCount(before - 1);
  await page.keyboard.press('Control+z');
  await expect(lines).toHaveCount(before);
  await page.keyboard.press('Control+Shift+z');
  await expect(lines).toHaveCount(before - 1);
  await page.keyboard.press('Control+z');
  await expect(lines).toHaveCount(before);

  // Keyboard: select all, duplicate keeps the lines between copies, undo.
  await canvas.click({ position: { x: 30, y: 30 } });
  await page.keyboard.press('Control+a');
  await expect(canvas.locator('[data-node][aria-pressed="true"]')).toHaveCount(5);
  await page.keyboard.press('Control+d');
  await expect(canvas.locator('[data-node]')).toHaveCount(10);
  await expect(lines).toHaveCount(before * 2);
  await page.keyboard.press('Control+z');
  await expect(canvas.locator('[data-node]')).toHaveCount(5);
  // Typing in a field doesn't trigger shortcuts.
  await page.getByLabel('Action name').focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Delete');
  await expect(canvas.locator('[data-node]')).toHaveCount(5);
  await expect(page.getByLabel('Action name')).toHaveValue('Count deaths');

  // Tidy up arranges the flow in one undo step.
  const beforeTidy = await pos(node(page, 'Another one'));
  await page.getByRole('button', { name: 'Tidy up' }).click();
  await expect.poll(() => pos(node(page, 'Another one'))).not.toEqual(beforeTidy);
  const trig = await pos(node(page, '!death'));
  const addAt = await pos(node(page, 'counter.deaths + 1'));
  expect(addAt[1]).toBeGreaterThan(trig[1]);
  await page.keyboard.press('Control+z');
  await expect.poll(() => pos(node(page, 'Another one'))).toEqual(beforeTidy);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => pos(node(page, 'Another one'))).not.toEqual(beforeTidy);

  // Collapse and expand a list section.
  const section = list.getByRole('button', { name: /Chat commands/ });
  await section.click();
  await expect(list.getByRole('button', { name: /^Count deaths/ })).toBeHidden();
  await list.getByRole('searchbox', { name: 'Search actions' }).fill('death');
  await expect(list.getByRole('button', { name: /^Count deaths/ })).toBeVisible();
  await list.getByRole('searchbox', { name: 'Search actions' }).fill('');
  await section.click();
  await expect(list.getByRole('button', { name: /^Count deaths/ })).toBeVisible();

  // Resize the action list.
  const handle = page.getByRole('separator', { name: 'Resize action list' });
  const w0 = Number(await handle.getAttribute('aria-valuenow'));
  const hb = (await handle.boundingBox())!;
  await drag(page, { x: hb.x + 1, y: hb.y + 200 }, { x: hb.x + 61, y: hb.y + 200 });
  await expect(handle).toHaveAttribute('aria-valuenow', String(w0 + 60));

  // Collapse the run log to give the variables room, then bring it back.
  const runLog = page.getByRole('region', { name: 'Run log' });
  await runLog.getByRole('button', { name: /Run log/ }).click();
  await expect(page.getByRole('separator', { name: 'Resize run log and variables' })).toHaveCount(0);
  await runLog.getByRole('button', { name: /Run log/ }).click();
  await expect(page.getByRole('separator', { name: 'Resize run log and variables' })).toBeVisible();

  // Test runs it and marks each node from the run results.
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(runLog.getByRole('button', { name: 'Count deaths' })).toBeVisible();
  await expect(card(page, '!death')).toHaveAttribute('aria-label', /Ran fine/);
  await expect(card(page, 'counter.deaths + 1')).toHaveAttribute('aria-label', /Ran fine/);
  await expect(card(page, 'Another one')).toHaveAttribute('aria-label', /Ran fine/);
  await expect(canvas.locator('..').getByRole('status').first()).toContainText('Last run worked');

  expect(errors).toEqual([]);
});

test('automation flow: pan, zoom and fit', async ({ page }) => {
  const errors = await open(page);
  await page.getByRole('navigation', { name: 'Actions' }).getByRole('button', { name: /^Count deaths/ }).click();
  const canvas = page.getByRole('region', { name: 'Flow of Count deaths' });
  const trig = card(page, '!death');
  const a = (await trig.boundingBox())!;
  // Dragging empty canvas pans; nothing moves in the saved flow.
  const box = (await canvas.boundingBox())!;
  const [x0] = await pos(node(page, '!death'));
  await drag(page, { x: box.x + 40, y: box.y + 60 }, { x: box.x + 140, y: box.y + 100 });
  const b = (await trig.boundingBox())!;
  expect(Math.round(b.x - a.x)).toBe(100);
  expect((await pos(node(page, '!death')))[0]).toBe(x0);
  // Zoom in around the pointer, then fit.
  const pct = page.getByTitle('Reset zoom to 100%');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(pct).toHaveText('120%');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 400);
  await page.keyboard.up('Control');
  await expect.poll(async () => parseInt((await pct.textContent()) ?? '0')).toBeLessThan(120);
  await page.getByRole('button', { name: 'Fit to view (F)' }).click();
  await expect(pct).toHaveText('100%');
  // The overview moves the view.
  await expect(page.getByRole('img', { name: /Overview of the flow/ })).toBeVisible();
  // Shift-drag draws a selection box.
  const t = await center(trig);
  await page.keyboard.down('Shift');
  await drag(page, { x: box.x + 10, y: box.y + 10 }, { x: t.x, y: t.y });
  await page.keyboard.up('Shift');
  await expect(canvas.locator('[data-node][aria-pressed="true"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

/** Big raid welcome with a branch: Wait, then If big raid → scene and clip, otherwise a thank-you. */
async function richFlow(page: Page) {
  const list = page.getByRole('navigation', { name: 'Actions' });
  await list.getByRole('button', { name: /^Big raid welcome/ }).click();
  const canvas = page.getByRole('region', { name: /^Flow of/ });
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  const picker = page.getByRole('dialog', { name: 'Add a step' });
  const wait = node(page, 'Wait 4 s');
  const r = (await wait.boundingBox())!;
  await connect(page, wait, 'right', { x: r.x + r.width + 120, y: r.y + r.height / 2 });
  await picker.getByRole('option', { name: /^If/ }).click();
  await inspector.getByRole('button', { name: 'Add condition' }).click();
  await inspector.getByLabel('Field').fill('amount');
  await inspector.getByLabel('Field').press('Tab');
  await inspector.getByLabel('Comparison').selectOption('gte');
  await inspector.getByLabel('Value').fill('100');
  await inspector.getByLabel('Value').press('Tab');
  const iff = ifNode(page);
  const ib = (await iff.boundingBox())!;
  await connect(page, iff, 'bottom', { x: ib.x + ib.width / 2 - 60, y: ib.y + ib.height + 110 });
  await picker.getByRole('option', { name: /^Switch scene/ }).click();
  await inspector.getByLabel('Scene').selectOption({ index: 1 });
  await connect(page, iff, 'right', { x: ib.x + ib.width + 140, y: ib.y + ib.height + 60 });
  await picker.getByRole('option', { name: /^Send chat message/ }).click();
  await inspector.getByRole('textbox', { name: 'Message', exact: true }).fill('Thanks for the raid {{name}}!');
  await expect(canvas.getByRole('button', { name: 'Otherwise', exact: true })).toBeVisible();
  await expect(page.getByText(/Not saved/)).toBeHidden();
  await page.getByRole('button', { name: 'Tidy up' }).click();
  await ifNode(page).locator('[data-node]').click();
}

for (const [w, h] of [
  [1440, 900],
  [2560, 1440]
] as const) {
  test(`automation flow screenshot ${w}x${h}`, async ({ page }) => {
    const errors = await open(page, w, h);
    await richFlow(page);
    await page.getByRole('button', { name: 'Test', exact: true }).click();
    await expect(card(page, 'Wait 4 s')).toHaveAttribute('aria-label', /Ran fine/);
    await expect(card(page, 'Thanks for the raid')).toHaveAttribute('aria-label', /Ran fine/);
    await expect(card(page, 'Go to')).toHaveAttribute('aria-label', /Skipped/);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(screens, `automation-flow-${w}.png`) });
    // Focus is on the Test button; Escape still closes the inspector.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeHidden();
    await page.getByRole('button', { name: 'Fit to view (F)' }).click();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(screens, `automation-flow-${w}-closed.png`) });
    expect(errors).toEqual([]);
  });
}

test('automation flow: dragging near the edge pans the canvas', async ({ page }) => {
  const errors = await open(page);
  await page.getByRole('navigation', { name: 'Actions' }).getByRole('button', { name: /^Count deaths/ }).click();
  const canvas = page.getByRole('region', { name: 'Flow of Count deaths' });
  const box = (await canvas.boundingBox())!;
  const chat = node(page, 'Send chat message');
  const [x0] = await pos(chat);
  const from = await center(card(page, 'Send chat message').locator('.title'));
  const to = { x: box.x + box.width - 4, y: from.y };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  // Hold still at the edge: the view keeps panning and the node stays under the pointer.
  await page.waitForTimeout(700);
  const t = await center(card(page, 'Send chat message').locator('.title'));
  expect(Math.abs(t.x - to.x)).toBeLessThan(24);
  await page.mouse.up();
  const [x1] = await pos(chat);
  expect(x1 - x0).toBeGreaterThan(to.x - from.x + 150);
  // Stops once the button is up.
  const b0 = (await card(page, '!death').boundingBox())!;
  await page.waitForTimeout(200);
  expect((await card(page, '!death').boundingBox())!.x).toBe(b0.x);
  // A whole drag is still one undo step.
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await pos(chat))[0]).toBe(x0);
  expect(errors).toEqual([]);
});

/** Wait, frame by frame, for the node with `text` to be running with `taken` lines marked. */
async function whileRunning(page: Page, text: string, taken: number) {
  await page.waitForFunction(
    ([text, taken]) => {
      const card = [...document.querySelectorAll('[data-node]')].find((n) => n.textContent?.includes(text as string));
      return /Running/.test(card?.getAttribute('aria-label') ?? '') && document.querySelectorAll('[data-edge].ran').length === taken;
    },
    [text, taken],
    { polling: 'raf', timeout: 5000 }
  );
}

test('automation flow: live trace and past runs', async ({ page }) => {
  const errors = await open(page);
  await page.getByRole('navigation', { name: 'Actions' }).getByRole('button', { name: /^Count deaths/ }).click();
  const canvas = page.getByRole('region', { name: 'Flow of Count deaths' });
  const lines = canvas.locator('[data-edge]');
  await expect(lines).toHaveCount(2);

  // While it runs, nodes light up one by one and the lines taken are marked.
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await whileRunning(page, 'counter.deaths + 1', 1);
  await whileRunning(page, 'Send chat message', 2);
  await expect(card(page, 'Send chat message')).toHaveAttribute('aria-label', /Ran fine/);
  await expect(canvas.locator('..').getByRole('status').first()).toContainText('Last run worked');

  // A second run; both are in the history.
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(canvas.locator('..').getByRole('status').first()).toContainText('Running');
  await expect(canvas.locator('..').getByRole('status').first()).toContainText('Last run worked');
  const runs = page.getByRole('button', { name: /^Runs/ });
  await expect(runs).toContainText('2');
  await runs.click();
  const menu = page.getByRole('menu', { name: 'Past runs' });
  await expect(menu.getByRole('menuitem')).toHaveCount(2);
  await menu.getByRole('menuitem').nth(1).click();

  // Step through the older run.
  const bar = page.getByRole('toolbar', { name: 'Past run' });
  await expect(bar).toContainText('Step 3 of 3');
  await expect(card(page, 'Send chat message').locator('..')).toHaveClass(/current/);
  await bar.getByRole('button', { name: 'Previous step' }).click();
  await expect(bar).toContainText('Step 2 of 3');
  await expect(canvas.locator('[data-edge].ran')).toHaveCount(1);
  await expect(card(page, 'counter.deaths + 1').locator('..')).toHaveClass(/current/);
  await expect(card(page, 'Send chat message')).not.toHaveAttribute('aria-label', /Ran fine/);
  await bar.getByRole('button', { name: 'Previous step' }).click();
  await expect(bar).toContainText('Step 1 of 3');
  await expect(bar.getByRole('button', { name: 'Previous step' })).toBeDisabled();
  await expect(canvas.locator('[data-edge].ran')).toHaveCount(0);
  await bar.getByRole('button', { name: 'Next step' }).click();
  await expect(bar).toContainText('Step 2 of 3');

  // Esc goes back to the latest run.
  await page.keyboard.press('Escape');
  await expect(bar).toBeHidden();
  await expect(canvas.locator('[data-edge].ran')).toHaveCount(2);
  await expect(canvas.locator('.current')).toHaveCount(0);
  // And so does Live.
  await runs.click();
  await menu.getByRole('menuitem').first().click();
  await bar.getByRole('button', { name: 'Live' }).click();
  await expect(bar).toBeHidden();
  expect(errors).toEqual([]);
});

test('automation flow: trace screenshot', async ({ page }) => {
  const errors = await open(page, 1440, 900);
  await richFlow(page);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Fit to view (F)' }).click();
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(card(page, 'Wait 4 s')).toHaveAttribute('aria-label', /Running/);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(screens, 'automation-trace.png') });
  await expect(card(page, 'Thanks for the raid')).toHaveAttribute('aria-label', /Ran fine/);
  expect(errors).toEqual([]);
});
