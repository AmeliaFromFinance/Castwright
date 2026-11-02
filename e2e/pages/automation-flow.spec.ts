import { expect, test, type Page } from '@playwright/test';
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

const node = (page: Page, key: string) => page.locator(`[data-node="${key}"]`);

test('automation flow: build, move, undo, test', async ({ page }) => {
  const errors = await open(page);
  const list = page.getByRole('navigation', { name: 'Actions' });
  await list.getByRole('button', { name: /^Count deaths/ }).click();

  const canvas = page.getByRole('region', { name: 'Flow of Count deaths' });
  await expect(canvas).toBeVisible();
  await expect(node(page, 't.0')).toContainText('!death');
  await expect(node(page, 's.0')).toContainText('counter.deaths + 1');
  await expect(node(page, 's.1')).toContainText('Send chat message');

  // Add an if at the end, then a step inside Then.
  await canvas.getByRole('button', { name: 'Add step', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Add a step' });
  await picker.getByRole('textbox').fill('if');
  await picker.getByRole('option', { name: /^If/ }).click();
  await expect(node(page, 's.2')).toContainText('If');
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await expect(inspector).toContainText('The steps for Then and Otherwise are in the flow.');

  await canvas.getByRole('button', { name: 'Add to Then', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add a step' }).getByRole('option', { name: /^Log/ }).click();
  await expect(node(page, 's.2.then.0')).toContainText('Log');
  await inspector.getByRole('textbox', { name: 'Text', exact: true }).fill('Another one');
  await expect(node(page, 's.2.then.0')).toContainText('Another one');

  // Drag the chat message into Otherwise.
  await node(page, 's.1').dragTo(canvas.locator('.cell.end.lane').nth(1).locator('.gap'));
  await expect(node(page, 's.1')).toContainText('If');
  await expect(node(page, 's.1.else.0')).toContainText('Send chat message');
  await expect(node(page, 's.1.else.0')).toHaveAttribute('aria-pressed', 'true');

  // Undo puts it back; redo moves it again.
  await page.keyboard.press('Control+z');
  await expect(node(page, 's.1')).toContainText('Send chat message');
  await expect(node(page, 's.1.else.0')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(node(page, 's.1.else.0')).toContainText('Send chat message');

  // Keyboard: move with the menu, select with arrows, delete and undo.
  await node(page, 's.1.then.0').click();
  await inspector.getByRole('button', { name: 'Move to' }).click();
  await page.getByRole('menuitem', { name: 'Otherwise of step 2' }).click();
  await expect(node(page, 's.1.else.1')).toContainText('Another one');
  await page.keyboard.press('Escape');
  await expect(inspector).toBeHidden();
  await page.keyboard.press('ArrowUp');
  await expect(node(page, 's.1.else.0')).toBeFocused();
  await page.keyboard.press('Delete');
  await expect(node(page, 's.1.else.0')).toContainText('Another one');
  await page.keyboard.press('Control+z');
  await expect(node(page, 's.1.else.0')).toContainText('Send chat message');
  await page.keyboard.press('Control+d');
  await expect(node(page, 's.1.else.1')).toContainText('Send chat message');
  await page.keyboard.press('Control+z');
  await expect(node(page, 's.1.else.1')).toContainText('Another one');
  // Typing in a field doesn't trigger shortcuts.
  await page.getByLabel('Action name').focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Delete');
  await expect(node(page, 's.1.else.0')).toBeVisible();
  await expect(page.getByLabel('Action name')).toHaveValue('Count deaths');

  // Collapse and expand a list section.
  const section = list.getByRole('button', { name: /Chat commands/ });
  await section.click();
  await expect(list.getByRole('button', { name: /^Count deaths/ })).toBeHidden();
  await list.getByRole('searchbox', { name: 'Search actions' }).fill('death');
  await expect(list.getByRole('button', { name: /^Count deaths/ })).toBeVisible();
  await list.getByRole('searchbox', { name: 'Search actions' }).fill('');
  await expect(list.getByRole('button', { name: /^Count deaths/ })).toBeHidden();
  await section.click();
  await expect(list.getByRole('button', { name: /^Count deaths/ })).toBeVisible();

  // Resize the action list.
  const handle = page.getByRole('separator', { name: 'Resize action list' });
  const before = Number(await handle.getAttribute('aria-valuenow'));
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 1, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 61, box.y + 200, { steps: 4 });
  await page.mouse.up();
  await expect(handle).toHaveAttribute('aria-valuenow', String(before + 60));

  // Collapse the run log to give the variables room, then bring it back.
  const log = page.getByRole('region', { name: 'Run log' });
  await log.getByRole('button', { name: /Run log/ }).click();
  await expect(page.getByRole('separator', { name: 'Resize run log and variables' })).toHaveCount(0);
  await log.getByRole('button', { name: /Run log/ }).click();
  await expect(page.getByRole('separator', { name: 'Resize run log and variables' })).toBeVisible();

  // Test runs it and marks the nodes.
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(log.getByRole('button', { name: 'Count deaths' })).toBeVisible();
  await expect(node(page, 's.0')).toHaveAttribute('aria-label', /Ran fine/);
  await expect(canvas.locator('..').getByRole('status')).toContainText('Last run worked');

  // List view is remembered.
  await page.getByRole('radio', { name: 'List' }).click();
  await expect(page.locator('[data-step="1.else.1"]')).toBeVisible();
  await page.reload();
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Automation' }).click();
  await expect(page.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: 'Flow' }).click();

  expect(errors).toEqual([]);
});

async function richFlow(page: Page) {
  const list = page.getByRole('navigation', { name: 'Actions' });
  await list.getByRole('button', { name: /^Big raid welcome/ }).click();
  const canvas = page.getByRole('region', { name: /^Flow of/ });
  // An if after the wait, with a nested if in Then.
  await node(page, 's.0').hover();
  await canvas.getByRole('button', { name: 'Insert step here' }).nth(1).click();
  await page.getByRole('dialog', { name: 'Add a step' }).getByRole('option', { name: /^If/ }).click();
  await page.getByRole('complementary', { name: 'Inspector' }).getByRole('button', { name: 'Add condition' }).click();
  await page.getByRole('complementary', { name: 'Inspector' }).getByLabel('Field').fill('amount');
  await page.getByRole('complementary', { name: 'Inspector' }).getByLabel('Field').press('Tab');
  await page.getByRole('complementary', { name: 'Inspector' }).getByLabel('Comparison').selectOption('gte');
  await page.getByRole('complementary', { name: 'Inspector' }).getByLabel('Value').fill('100');
  await page.getByRole('complementary', { name: 'Inspector' }).getByLabel('Value').press('Tab');
  await canvas.getByRole('button', { name: 'Add to Then', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add a step' }).getByRole('option', { name: /^Switch scene/ }).click();
  await page.getByRole('complementary', { name: 'Inspector' }).getByLabel('Scene').selectOption({ index: 1 });
  await canvas.getByRole('button', { name: 'Add to Then', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add a step' }).getByRole('option', { name: /^Create clip/ }).click();
  await canvas.getByRole('button', { name: 'Add to Otherwise', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add a step' }).getByRole('option', { name: /^Send chat message/ }).click();
  await page.getByRole('complementary', { name: 'Inspector' }).getByRole('textbox', { name: 'Message', exact: true }).fill('Thanks for the raid {{name}}!');
  await expect(node(page, 's.1.else.0')).toContainText('Thanks for the raid');
  await expect(page.getByText(/Not saved/)).toBeHidden();
  await node(page, 's.1').click();
  await canvas.evaluate((el) => el.scrollTo(0, 0));
}

for (const [w, h] of [
  [1440, 900],
  [2560, 1440]
] as const) {
  test(`automation flow screenshot ${w}x${h}`, async ({ page }) => {
    const errors = await open(page, w, h);
    await richFlow(page);
    await page.getByRole('button', { name: 'Test', exact: true }).click();
    await expect(node(page, 's.0')).toHaveAttribute('aria-label', /Ran fine/);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(screens, `automation-flow-${w}.png`) });
    // Focus is on the Test button; Escape still closes the inspector.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeHidden();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(screens, `automation-flow-${w}-closed.png`) });
    expect(errors).toEqual([]);
  });
}
