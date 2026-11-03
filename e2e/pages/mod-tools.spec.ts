import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubProviders } from '../providers';

const screens = join(dirname(fileURLToPath(import.meta.url)), '__screens__');

async function openChat(page: Page, query = 'demo=static'): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || (m.type() === 'warning' && m.text().includes('[svelte]'))) errors.push(`console: ${m.text()}`);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await stubProviders(page);
  await page.goto(`/?${query}`);
  await expect(page.locator('.splash')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Activity' }).click();
  await page.getByRole('radio', { name: /Chat/ }).click();
  return errors;
}

const chat = (page: Page) => page.getByRole('listbox', { name: 'Chat messages' });

test('time out from a message, then delete with the keyboard', async ({ page }) => {
  mkdirSync(screens, { recursive: true });
  const errors = await openChat(page);
  const pixel = chat(page).getByRole('option', { name: /^pixelbyte:/ });
  const first = pixel.first();
  await first.hover();
  await first.getByRole('button', { name: 'Message actions' }).click();
  const menu = page.getByRole('menu', { name: 'Message actions for pixelbyte' });
  await expect(menu.getByRole('menuitem', { name: 'Delete message' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Ban…' })).toBeVisible();
  await page.screenshot({ path: join(screens, 'chat-mod-menu.png') });

  await menu.getByRole('menuitem', { name: 'Time out 10m' }).click();
  await expect(page.getByText('pixelbyte timed out')).toBeVisible();
  // A timeout clears their messages: shown as deleted, not removed.
  await expect(pixel.first().getByText('deleted')).toBeVisible();
  expect(await pixel.count()).toBeGreaterThan(0);

  // Right-click opens the same menu; D deletes a focused message.
  const nova = chat(page).getByRole('option', { name: /^nova_kat:/ }).last();
  await nova.click({ button: 'right' });
  await expect(page.getByRole('menu', { name: 'Message actions for nova_kat' })).toBeVisible();
  await page.keyboard.press('Escape');
  await nova.focus();
  await page.keyboard.press('d');
  await expect(nova.getByText('deleted')).toBeVisible();

  // B asks before banning.
  const fox = chat(page).getByRole('option', { name: /^quietfox:/ }).last();
  await fox.focus();
  await page.keyboard.press('b');
  const ask = page.getByRole('dialog', { name: 'Ban quietfox?' });
  await ask.getByLabel('Reason (optional)').fill('spam links');
  await ask.getByRole('button', { name: 'Ban', exact: true }).click();
  await expect(page.getByText('quietfox banned')).toBeVisible();
  expect(errors).toEqual([]);
});

test('viewer card shows account facts, messages and a saved note', async ({ page }) => {
  const errors = await openChat(page);
  await chat(page).getByRole('option', { name: /^m0ss:/ }).last().getByRole('button', { name: 'm0ss' }).click();
  const card = page.getByRole('dialog', { name: 'Viewer card: m0ss' });
  await expect(card).toContainText('old ·');
  await expect(card).toContainText('Not following');
  await expect(card).toContainText('Not subscribed');
  await expect(card.getByRole('list', { name: 'Recent messages' }).getByRole('listitem').first()).toBeVisible();
  await card.getByLabel('Mod note').fill('Regular, asks good questions');
  await page.mouse.move(0, 0);
  await page.screenshot({ path: join(screens, 'viewer-card.png') });
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);

  await page.reload();
  await expect(page.locator('.splash')).toHaveCount(0);
  await page.getByRole('radio', { name: /Chat/ }).click();
  await chat(page).getByRole('option', { name: /^m0ss:/ }).last().getByRole('button', { name: 'm0ss' }).click();
  await expect(page.getByRole('dialog', { name: 'Viewer card: m0ss' }).getByLabel('Mod note')).toHaveValue('Regular, asks good questions');

  // Time out from the card; the status follows.
  await page.getByRole('dialog', { name: 'Viewer card: m0ss' }).getByRole('button', { name: 'Custom timeout' }).click();
  const ask = page.getByRole('dialog', { name: 'Time out m0ss' });
  await ask.getByLabel('Duration').fill('2');
  await ask.getByLabel('Unit').selectOption('h');
  await ask.getByRole('button', { name: 'Time out' }).click();
  await expect(page.getByText('m0ss timed out')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Viewer card: m0ss' }).getByRole('button', { name: 'Unban' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('chat mode toggles in the header', async ({ page }) => {
  const errors = await openChat(page);
  const modes = page.getByRole('group', { name: 'Chat modes' });
  const emotes = modes.getByRole('button', { name: 'Emote-only' });
  await expect(emotes).toHaveAttribute('aria-pressed', 'false');
  await emotes.click();
  await expect(emotes).toHaveAttribute('aria-pressed', 'true');

  await modes.getByRole('button', { name: 'Slow mode' }).click();
  await page.getByRole('group', { name: 'Slow mode options' }).getByRole('button', { name: '10s' }).click();
  const slow = modes.getByRole('button', { name: 'Slow mode' });
  await expect(slow).toHaveAttribute('aria-pressed', 'true');
  await expect(slow).toContainText('10s');
  await slow.click();
  await page.getByRole('group', { name: 'Slow mode options' }).getByRole('button', { name: 'Turn off' }).click();
  await expect(slow).toHaveAttribute('aria-pressed', 'false');

  await modes.getByRole('button', { name: 'Shield mode' }).click();
  await expect(modes.getByRole('button', { name: 'Shield mode' })).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('an old sign-in is asked to sign in again only when a mod tool is used', async ({ page }) => {
  const errors = await openChat(page, 'demo=static&oldscopes');
  await expect(page.getByText(/new Twitch permissions/)).toHaveCount(0);
  await page.getByRole('group', { name: 'Chat modes' }).getByRole('button', { name: 'Subs-only' }).click();
  await expect(page.getByText(/new Twitch permissions/)).toBeVisible();
  await expect(page.getByRole('group', { name: 'Chat modes' }).getByRole('button', { name: 'Subs-only' })).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});
