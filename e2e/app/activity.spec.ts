import { expect, test } from '@playwright/test';
import { fixture } from '../providers';
import { goTo, openApp } from './helpers';

test('filter, inspect and replay events', async ({ page }) => {
  const errors = await openApp(page);
  await goTo(page, 'Activity');
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible();
  const all = await rows.count();

  await page.getByRole('button', { name: 'Follows' }).click();
  await expect.poll(() => rows.count()).toBeLessThan(all);
  for (const text of await rows.locator('td:nth-child(2)').allTextContents()) expect(text).toContain('Follow');

  await rows.first().click();
  const detail = page.getByRole('complementary', { name: 'Event details' });
  await expect(detail).toContainText('followed');
  await detail.getByRole('button', { name: 'Replay alert' }).click();
  await expect(page.getByText('Alert queued')).toBeVisible();

  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByLabel('Search events by name').fill('zzzz-nobody');
  await expect(page.getByText('Nothing matches')).toBeVisible();

  await page.getByRole('radio', { name: /Log/ }).click();
  await expect(page.getByText('Connected to OBS')).toBeVisible();
  expect(errors).toEqual([]);
});

test('chat tab shows third-party emotes, paints and badges', async ({ page }) => {
  const errors = await openApp(page, 'demo=static', {
    seventvGlobal: fixture('7tv-global'),
    bttvGlobal: fixture('bttv-global'),
    cosmetics: fixture('7tv-cosmetics'),
    styles: { '1000': { paint: '01HQE7KJWG0000D7GK7EKRAPN3', badge: '01JJJ74CRHZBRMCM8F4Y2WBN6R' } }
  });
  await goTo(page, 'Activity');
  await page.getByRole('radio', { name: /Chat/ }).click();
  const chat = page.getByRole('listbox', { name: 'Chat messages' });
  await expect(chat.locator('img.cw-emote-7tv[alt="peepoHappy"]').first()).toBeVisible();
  await expect(chat.locator('img.cw-emote-bttv[alt="monkaS"]').first()).toBeVisible();
  await expect(chat.locator('.cw-emote-stack img.cw-emote-zw[alt="RainTime"]').first()).toBeAttached();
  await expect(chat.locator('img.cw-badge-twitch').first()).toBeVisible();
  const nova = chat.locator('li', { hasText: 'nova_kat' }).last();
  await expect(nova.locator('.cw-paint')).toHaveCount(1);
  expect(await nova.locator('.cw-paint').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('radial-gradient');
  await expect(nova.locator('img.cw-badge-7tv')).toBeVisible();

  // Switching providers off is remembered.
  await page.getByRole('button', { name: 'Chat display options' }).click();
  await page.getByRole('switch', { name: 'BetterTTV emotes' }).click();
  await expect(chat.locator('img.cw-emote-bttv')).toHaveCount(0);
  await expect(chat).toContainText('monkaS');
  await page.reload();
  await expect(page.locator('.splash')).toHaveCount(0);
  await goTo(page, 'Activity');
  await page.getByRole('radio', { name: /Chat/ }).click();
  await expect(chat.locator('img.cw-emote-7tv').first()).toBeVisible();
  await expect(chat.locator('img.cw-emote-bttv')).toHaveCount(0);
  expect(errors).toEqual([]);
});
