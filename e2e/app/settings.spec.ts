import { expect, test } from '@playwright/test';
import { goTo, openApp } from './helpers';

test('create, apply and delete a custom theme', async ({ page }) => {
  const errors = await openApp(page);
  await goTo(page, 'Settings');
  await page.getByRole('button', { name: 'Appearance' }).click();

  await page.getByRole('button', { name: 'New theme' }).click();
  await page.locator('#theme-name').fill('Test theme');
  await page.getByRole('button', { name: 'Hue 155' }).click();
  await expect(page.getByText('All checks pass')).toBeVisible();
  await page.getByRole('button', { name: 'Create theme' }).click();

  const card = page.getByRole('radio', { name: /Test theme/ });
  await expect(card).toHaveAttribute('aria-checked', 'true');
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  expect(accent).toMatch(/^#[0-9a-f]{6}$/);

  await card.hover();
  await page.getByRole('button', { name: 'Edit Test theme' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('radio', { name: /Test theme/ })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: /Match system/ })).toHaveAttribute('aria-checked', 'true');
  expect(errors).toEqual([]);
});

test('import rejects bad JSON and accepts a valid theme', async ({ page }) => {
  const errors = await openApp(page);
  await goTo(page, 'Settings');
  await page.getByRole('button', { name: 'Appearance' }).click();
  await page.getByRole('button', { name: 'Import' }).click();
  await page.getByLabel('Theme JSON').fill('{nope');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert')).toContainText('valid theme JSON');
  await page.getByLabel('Theme JSON').fill(JSON.stringify({ id: 'x', name: 'Shared', base: 'light', accent_hue: 20 }));
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#theme-name')).toHaveValue('Shared');
  await page.getByRole('button', { name: 'Create theme' }).click();
  await expect(page.getByRole('radio', { name: /Shared/ })).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => document.documentElement.dataset.base)).toBe('light');
  expect(errors).toEqual([]);
});

test('interface size and server settings', async ({ page }) => {
  const errors = await openApp(page);
  await page.keyboard.press('Control+Comma');
  await page.getByRole('button', { name: 'Appearance' }).click();
  const slider = page.getByRole('slider', { name: 'Interface size' });
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => document.documentElement.style.zoom)).toBe('1.1');

  await page.getByRole('button', { name: 'Overlay server' }).click();
  const port = page.locator('#server input.port');
  await port.fill('80');
  await expect(page.getByRole('button', { name: 'Apply and restart server' })).toBeDisabled();
  await port.fill('7480');
  await page.getByRole('button', { name: 'Apply and restart server' }).click();
  await expect(page.getByText('http://127.0.0.1:7480').first()).toBeVisible();
  expect(errors).toEqual([]);
});
