import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubProviders } from '../providers';

const here = dirname(fileURLToPath(import.meta.url));
const screens = join(here, '__screens__');


// The app runs on the shared server from playwright.config.ts.
const base = 'http://localhost:4317';

test.beforeAll(() => {
  mkdirSync(screens, { recursive: true });
});

async function open(page: Page, section: 'Alerts' | 'Automation'): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || (m.type() === 'warning' && m.text().includes('[svelte]'))) errors.push(`console: ${m.text()}`);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await stubProviders(page);
  await page.goto(`${base}/?demo=static`);
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: section }).click();
  await expect(page.getByRole('heading', { level: 1, name: section })).toBeVisible();
  return errors;
}

test('alerts: variations, preview, order and queue', async ({ page }) => {
  const errors = await open(page, 'Alerts');

  await page.getByRole('button', { name: /^Subscription/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Subscription' })).toBeVisible();
  const cards = page.locator('[data-variation]');
  await expect(cards).toHaveCount(2);

  await page.getByRole('button', { name: 'Add variation' }).click();
  await expect(cards).toHaveCount(3);
  const card = cards.first();
  await expect(card.getByLabel('Name')).toHaveValue('Variation 3');
  await card.getByLabel('Name').fill('Long timers');

  await card.getByRole('button', { name: 'Add condition' }).click();
  await card.getByLabel('Field').fill('months');
  await card.getByLabel('Field').press('Tab');
  await card.getByLabel('Comparison').selectOption('gte');
  await card.getByLabel('Value').fill('12');
  await card.getByLabel('Value').press('Tab');
  await expect(card.locator('.when')).toHaveText('months ≥ 12');

  const title = card.getByRole('textbox', { name: 'Title', exact: true });
  await title.fill('Thanks ');
  await card.getByRole('group', { name: 'Insert into Title' }).getByRole('button', { name: 'name' }).click();
  await title.press('End');
  await title.pressSequentially(' for {{months}} months!');
  await expect(title).toHaveValue('Thanks {{name}} for {{months}} months!');

  const preview = page.getByRole('region', { name: 'Preview' });
  await expect(preview.locator('[data-alert-id]')).toContainText(/Thanks \S+ for 12 months!/);
  await expect(preview.locator('[data-alert-id]')).toContainText('Tier 1');

  // New variations go on top; move it below the Tier 3 one.
  await card.getByRole('button', { name: 'Move down' }).click();
  await expect(cards.locator('.name')).toHaveText(['Tier 3', 'Long timers', 'Default']);
  await expect(preview).toContainText(/Thanks \S+ for 12 months!/);

  // Edits survive leaving the page.
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Activity' }).click();
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Alerts' }).click();
  await page.getByRole('button', { name: /^Subscription/ }).click();
  await expect(cards.locator('.name')).toHaveText(['Tier 3', 'Long timers', 'Default']);
  await expect(page.getByRole('button', { name: /^Subscription/ })).toContainText('3 variations');

  await page.getByRole('button', { name: 'Pause alerts' }).click();
  await expect(page.getByRole('button', { name: 'Resume alerts' })).toBeVisible();
  await page.getByRole('region', { name: 'Subscription variations' }).getByRole('button', { name: 'Test', exact: true }).click();
  const waiting = page.getByRole('list', { name: 'Waiting alerts' }).getByRole('listitem');
  await expect(waiting).toHaveCount(1);
  await expect(waiting.first()).toContainText('test');
  await page.getByRole('button', { name: 'Test Follow' }).click();
  await expect(waiting).toHaveCount(2);
  await waiting.first().getByRole('button', { name: 'Remove from queue' }).click();
  await expect(waiting).toHaveCount(1);

  await page.getByRole('button', { name: 'Alert settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Alert settings' });
  await dialog.getByLabel('Minimum bits').fill('100');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();

  const expand = cards.nth(1).locator('.expand');
  if ((await expand.getAttribute('aria-expanded')) !== 'true') await expand.click();
  await expect(preview.locator('[data-alert-id]')).toContainText(/Thanks \S+ for 12 months!/);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(screens, 'alerts.png') });
  expect(errors).toEqual([]);
});

test('automation: chat command built in the flow, run and log', async ({ page }) => {
  const errors = await open(page, 'Automation');

  await page.getByRole('button', { name: 'New action' }).click();
  await page.getByRole('menuitem', { name: /Blank action/ }).click();
  const name = page.getByLabel('Action name');
  await expect(name).toHaveValue('New action');
  await name.fill('Hug');
  await page.getByLabel('Group').fill('Chat commands');
  await page.getByLabel('Group').press('Tab');

  const canvas = page.getByRole('region', { name: 'Flow of Hug' });
  await expect(canvas.getByText('Start with a trigger')).toBeVisible();
  const bar = page.getByRole('toolbar', { name: 'Add to the flow' });
  await bar.getByRole('button', { name: 'Add trigger' }).click();
  await page.getByRole('dialog', { name: 'Add a trigger' }).getByRole('option', { name: /Chat command/ }).click();
  await expect(page.getByText('Type the command name, e.g. so for !so.').first()).toBeVisible();
  await expect(page.getByText(/Not saved: fix 1 problem/)).toBeVisible();
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await inspector.getByLabel('Command', { exact: true }).fill('!hug');
  await expect(inspector.getByLabel('Command', { exact: true })).toHaveValue('hug');
  await expect(page.getByText(/Not saved/)).toBeHidden();

  // With a node selected, the bar adds the next step under it, already connected.
  await bar.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add a step' }).getByRole('option', { name: /Send chat message/ }).click();
  const say = inspector.locator('[data-step]');
  await say.getByRole('textbox', { name: 'Message', exact: true }).fill('{{name}} gives ');
  await say.getByRole('group', { name: 'Insert into Message' }).getByRole('button', { name: 'arg1' }).click();
  await say.getByRole('textbox', { name: 'Message', exact: true }).press('End');
  await say.getByRole('textbox', { name: 'Message', exact: true }).pressSequentially(' a big hug');
  await expect(say.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('{{name}} gives {{arg1}} a big hug');
  await expect(canvas.locator('[data-edge]')).toHaveCount(1);

  await bar.getByRole('button', { name: 'Logic', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add a step' }).getByRole('option', { name: /^If/ }).click();
  await inspector.getByRole('button', { name: 'Add condition' }).first().click();
  await inspector.getByLabel('Field').fill('arg_count');
  await inspector.getByLabel('Field').press('Tab');
  await inspector.getByLabel('Comparison').selectOption('lt');
  await inspector.getByLabel('Value').fill('1');
  await inspector.getByLabel('Value').press('Tab');
  await bar.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add a step' }).getByRole('option', { name: /Send chat message/ }).click();
  await inspector.getByRole('textbox', { name: 'Message', exact: true }).fill('Who should I hug? Try !hug @name');
  await expect(canvas.locator('[data-edge][data-branch="then"]')).toHaveCount(1);
  await expect(canvas.getByRole('button', { name: 'Then', exact: true })).toBeVisible();
  await bar.getByRole('button', { name: 'Logic', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add a step' }).getByRole('option', { name: /^Stop/ }).click();
  await expect(canvas.locator('[data-node]', { hasText: 'End this run' })).toBeVisible();
  await expect(canvas.locator('[data-edge]')).toHaveCount(4);

  // Change the trigger.
  await page.getByRole('button', { name: 'Fit to view (F)' }).click();
  await canvas.locator('[data-node][aria-label^="Trigger"]').click();
  await inspector.getByLabel('Who can use it').selectOption('subscriber');
  await inspector.getByLabel('Also answers to').fill('cuddle, !squeeze');
  await inspector.getByLabel('Also answers to').press('Tab');
  await expect(inspector.getByLabel('Also answers to')).toHaveValue('cuddle, squeeze');
  await expect(page.locator('code.preview')).toHaveText('!hug <arg1>');
  await inspector.getByRole('button', { name: 'Close inspector (Esc)' }).click();

  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  const log = page.getByRole('region', { name: 'Run log' });
  await expect(log.getByRole('button', { name: 'Hug' })).toBeVisible();
  await expect(log).toContainText('manual');

  const list = page.getByRole('navigation', { name: 'Actions' });
  await expect(list.getByRole('button', { name: /^Hug !hug/ })).toBeVisible();

  // Survives a page switch.
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Alerts' }).click();
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Automation' }).click();
  await list.getByRole('button', { name: /^Hug/ }).click();
  await expect(page.getByRole('region', { name: 'Flow of Hug' }).locator('[data-node]', { hasText: 'End this run' })).toBeVisible();

  // Variables.
  const vars = page.getByRole('region', { name: 'Variables' });
  await vars.getByRole('button', { name: 'Add' }).click();
  await vars.getByLabel('New variable name').fill('bad key');
  await vars.getByRole('button', { name: 'Add', exact: true }).last().click();
  await expect(vars.getByRole('alert')).toBeVisible();
  await vars.getByLabel('New variable name').fill('hugs.total');
  await vars.getByLabel('New variable value').fill('41');
  await vars.getByRole('button', { name: 'Add', exact: true }).last().click();
  const value = vars.getByLabel('Value of hugs.total');
  await expect(value).toHaveValue('41');
  await value.fill('42');
  await value.press('Enter');
  await expect(value).toHaveValue('42');

  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(screens, 'automation.png') });
  expect(errors).toEqual([]);
});
