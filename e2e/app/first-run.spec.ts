import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

test('setup guide signs in to Twitch and finishes', async ({ page }) => {
  const errors = await openApp(page, 'demo=static&setup');
  await expect(page.getByRole('heading', { name: 'Welcome to Castwright' })).toBeVisible();
  await page.getByRole('radio', { name: 'Light' }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.base)).toBe('light');
  await page.getByRole('button', { name: 'Get started' }).click();

  const next = page.getByRole('button', { name: 'Next' });
  await expect(next).toBeDisabled();
  await page.getByRole('button', { name: 'Sign in with Twitch' }).click();
  await expect(page.getByText('WDJB-MJHT')).toBeVisible();
  // The demo backend approves the code after a few seconds.
  await expect(next).toBeEnabled({ timeout: 10_000 });
  await next.click();

  await expect(page.getByRole('heading', { name: 'Connect OBS' })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Twitch signed in as Castwright')).toBeVisible();
  await page.getByRole('button', { name: 'Open Castwright' }).click();
  await expect(page.getByRole('navigation', { name: 'Main sections' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('setup can be skipped', async ({ page }) => {
  await openApp(page, 'demo=static&setup');
  await page.getByRole('button', { name: 'Skip setup' }).click();
  await expect(page.getByRole('navigation', { name: 'Main sections' })).toBeVisible();
});
