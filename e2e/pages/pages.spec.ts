import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { createServer as netServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const screens = join(here, '__screens__');

let server: ViteDevServer;
let base = '';

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = netServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => ok(port));
    });
  });
}

test.beforeAll(async () => {
  const port = await freePort();
  server = await createServer({
    root,
    configFile: join(root, 'vite.config.ts'),
    logLevel: 'error',
    server: { port, strictPort: true, host: '127.0.0.1', hmr: false }
  });
  await server.listen();
  base = `http://127.0.0.1:${port}`;
  mkdirSync(screens, { recursive: true });
});

test.afterAll(async () => {
  await server?.close();
});

async function open(page: Page, section: 'Alerts' | 'Automation'): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || (m.type() === 'warning' && m.text().includes('[svelte]'))) errors.push(`console: ${m.text()}`);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
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
  await expect(preview.locator('[data-alert-id]')).toContainText('Thanks quietfox for 12 months!');
  await expect(preview.locator('[data-alert-id]')).toContainText('Tier 1');

  // New variations go on top; move it below the Tier 3 one.
  await card.getByRole('button', { name: 'Move down' }).click();
  await expect(cards.locator('.name')).toHaveText(['Tier 3', 'Long timers', 'Default']);
  await expect(preview).toContainText('Thanks quietfox for 12 months!');

  // Edits survive leaving the page.
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Studio' }).click();
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
  await expect(preview.locator('[data-alert-id]')).toContainText('Thanks quietfox for 12 months!');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(screens, 'alerts.png') });
  expect(errors).toEqual([]);
});

test('automation: chat command with nested steps, run and log', async ({ page }) => {
  const errors = await open(page, 'Automation');

  await page.getByRole('button', { name: 'New action' }).click();
  await page.getByRole('menuitem', { name: /Blank action/ }).click();
  const name = page.getByLabel('Action name');
  await expect(name).toHaveValue('New action');
  await name.fill('Hug');
  await page.getByLabel('Group').fill('Chat commands');
  await page.getByLabel('Group').press('Tab');

  await page.getByRole('button', { name: 'Add trigger' }).click();
  await page.getByRole('menuitem', { name: /Chat command/ }).click();
  await expect(page.getByText('Type the command name, e.g. so for !so.')).toBeVisible();
  await expect(page.getByText(/Not saved: fix 1 problem/)).toBeVisible();
  await page.getByLabel('Command', { exact: true }).fill('!hug');
  await expect(page.getByLabel('Command', { exact: true })).toHaveValue('hug');
  await expect(page.getByText(/Not saved/)).toBeHidden();

  const steps = page.getByRole('region', { name: 'Action editor' });
  await steps.getByRole('button', { name: 'Add step', exact: true }).click();
  await page.getByRole('menuitem', { name: /Send chat message/ }).click();
  const say = page.locator('[data-step="0"]');
  await say.getByRole('textbox', { name: 'Message', exact: true }).fill('{{name}} gives ');
  await say.getByRole('group', { name: 'Insert into Message' }).getByRole('button', { name: 'arg1' }).click();
  await say.getByRole('textbox', { name: 'Message', exact: true }).press('End');
  await say.getByRole('textbox', { name: 'Message', exact: true }).pressSequentially(' a big hug');
  await expect(say.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('{{name}} gives {{arg1}} a big hug');

  await steps.getByRole('button', { name: 'Add step', exact: true }).click();
  await page.getByRole('menuitem', { name: /^If/ }).click();
  const iff = page.locator('[data-step="1"]');
  await iff.getByRole('button', { name: 'Add condition' }).first().click();
  await iff.getByLabel('Field').fill('arg_count');
  await iff.getByLabel('Field').press('Tab');
  await iff.getByLabel('Comparison').selectOption('lt');
  await iff.getByLabel('Value').fill('1');
  await iff.getByLabel('Value').press('Tab');
  await iff.getByRole('button', { name: 'Add step to Then' }).click();
  await page.getByRole('menuitem', { name: /Send chat message/ }).click();
  const nested = page.locator('[data-step="1.then.0"]');
  await nested.getByRole('textbox', { name: 'Message', exact: true }).fill('Who should I hug? Try !hug @name');
  await iff.getByRole('button', { name: 'Add step to Then' }).click();
  await page.getByRole('menuitem', { name: /^Stop/ }).click();
  await expect(page.locator('[data-step="1.then.1"]')).toContainText('Stop');

  // The check should come first.
  await iff.getByRole('button', { name: 'Move step up' }).first().click();
  await expect(page.locator('[data-step="0"] > header')).toContainText('If');
  await expect(page.locator('[data-step="0.then.0"]').getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Who should I hug? Try !hug @name');
  await expect(page.locator('[data-step="1"] > header')).toContainText('Send chat message');

  // Change the trigger.
  await page.getByLabel('Who can use it').selectOption('subscriber');
  await page.getByLabel('Also answers to').fill('cuddle, !squeeze');
  await page.getByLabel('Also answers to').press('Tab');
  await expect(page.getByLabel('Also answers to')).toHaveValue('cuddle, squeeze');
  await expect(page.locator('code.preview')).toHaveText('!hug <arg1>');

  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Run now' }).first().click();
  const log = page.getByRole('region', { name: 'Run log' });
  await expect(log.getByRole('button', { name: 'Hug' })).toBeVisible();
  await expect(log).toContainText('manual');

  const list = page.getByRole('navigation', { name: 'Actions' });
  await expect(list.getByRole('button', { name: /^Hug !hug/ })).toBeVisible();

  // Survives a page switch.
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Alerts' }).click();
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Automation' }).click();
  await list.getByRole('button', { name: /^Hug/ }).click();
  await expect(page.locator('[data-step="0.then.1"]')).toContainText('Stop');

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
  await page.locator('.center').evaluate((el) => el.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(screens, 'automation.png') });
  expect(errors).toEqual([]);
});
