import { expect, test, type Locator, type Page } from '@playwright/test';
import { stubProviders } from '../providers';

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || (m.type() === 'warning' && m.text().includes('[svelte]'))) errors.push(`console: ${m.text()}`);
  });
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await stubProviders(page);
  await page.goto('/?demo=static', { timeout: 90_000 });
  await page.getByRole('button', { name: 'Overlays', exact: true }).click();
  await page.locator('[data-overlay-card]').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByLabel('Overlay name')).toHaveValue('Gameplay HUD');
});

test.afterEach(() => {
  expect(errors, 'no page or console errors').toEqual([]);
});

const canvas = (page: Page) => page.locator('.cw-stage').first();
const row = (page: Page, name: string) => page.locator('[data-layer-row]').filter({ hasText: name }).locator('.pick');
const fontSize = (l: Locator) => l.evaluate((el) => getComputedStyle(el).fontSize);
const chatText = (page: Page) => canvas(page).locator('.cw-type-chat .cw-chat-line').first();
const goalText = (page: Page) => canvas(page).locator('.cw-type-goal .cw-text').first();

async function fontSizeField(page: Page) {
  const size = page.getByLabel('Font size').first();
  if (!(await size.isVisible())) await page.getByRole('button', { name: 'Text style', exact: true }).first().click();
  return size;
}

test('two layers picked in the list share one font size', async ({ page }) => {
  // Give the chat its own size first, so the two differ.
  await row(page, 'Chat').click();
  await (await fontSizeField(page)).fill('30');
  await expect.poll(() => fontSize(chatText(page))).toBe('30px');

  await row(page, 'Sub goal').click({ modifiers: ['ControlOrMeta'] });
  const inspector = page.locator('[data-multi-inspector]');
  await expect(page.getByText('2 layers', { exact: true })).toBeVisible();
  const size = inspector.getByLabel('Font size');
  await expect(size).toHaveValue('');
  await expect(size).toHaveAttribute('placeholder', 'Mixed');

  await size.fill('36');
  await expect.poll(() => fontSize(chatText(page))).toBe('36px');
  await expect.poll(() => fontSize(goalText(page))).toBe('36px');
  await expect(size).toHaveValue('36');

  // One undo step for both.
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click();
  await expect.poll(() => fontSize(chatText(page))).toBe('30px');
  await expect.poll(() => fontSize(goalText(page))).toBe('22px');
});

test('shift-click on the canvas picks several, and dragging moves them together', async ({ page }) => {
  const chat = canvas(page).locator('.cw-type-chat');
  const goal = canvas(page).locator('.cw-type-goal');
  const centre = async (l: Locator) => {
    const b = (await l.boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const c = await centre(chat);
  const g = await centre(goal);
  await page.mouse.click(c.x, c.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(g.x, g.y);
  await page.keyboard.up('Shift');
  await expect(page.getByText('2 layers', { exact: true })).toBeVisible();
  await expect(page.locator('.surface [data-selected]')).toHaveCount(2);

  const before = [(await chat.boundingBox())!, (await goal.boundingBox())!];
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x - 40, c.y + 30, { steps: 6 });
  await page.mouse.up();
  const after = [(await chat.boundingBox())!, (await goal.boundingBox())!];
  const moved = after.map((a, i) => [Math.round(a.x - before[i]!.x), Math.round(a.y - before[i]!.y)]);
  expect(moved[0]).toEqual(moved[1]);
  expect(moved[0]![0]).toBeLessThan(0);
  expect(moved[0]![1]).toBeGreaterThan(0);

  // Delete removes both; undo brings them back.
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-layer-row]')).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-layer-row]')).toHaveCount(4);
});

test('a box dragged on empty canvas picks the layers it touches', async ({ page }) => {
  const frame = (await page.locator('.surface').boundingBox())!;
  const chat = (await canvas(page).locator('.cw-type-chat').boundingBox())!;
  // From the empty bottom-left corner up into the chat layer.
  await page.mouse.move(frame.x + 4, frame.y + frame.height - 4);
  await page.mouse.down();
  await page.mouse.move(chat.x + 10, chat.y + chat.height - 10, { steps: 8 });
  await expect(page.locator('.marquee')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('[data-layer-row] .pick[aria-pressed="true"]')).not.toHaveCount(0);
  await expect(row(page, 'Chat')).toHaveAttribute('aria-pressed', 'true');
});
