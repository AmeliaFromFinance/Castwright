import { expect, test } from '@playwright/test';
import { goTo, openApp } from './helpers';

test('command palette finds and runs commands', async ({ page }) => {
  const errors = await openApp(page);
  await page.keyboard.press('Control+k');
  const search = page.getByRole('combobox', { name: 'Search commands' });
  await expect(search).toBeFocused();
  await search.fill('test raid');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Test alert queued')).toBeVisible();

  await page.keyboard.press('Control+k');
  await search.fill('automation');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Automation' })).toHaveAttribute('aria-current', 'page');

  await page.keyboard.press('Control+k');
  await page.keyboard.press('Escape');
  await expect(search).toHaveCount(0);

  await page.keyboard.press('Control+/');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('zoom keys change and save the interface size', async ({ page }) => {
  const errors = await openApp(page);
  const zoom = () => page.evaluate(() => document.documentElement.style.zoom);
  await page.keyboard.press('Control+=');
  await expect.poll(zoom).toBe('1.1');
  await page.keyboard.press('Control+=');
  await expect.poll(zoom).toBe('1.25');
  await page.keyboard.press('Control+-');
  await expect.poll(zoom).toBe('1.1');
  await page.keyboard.press('Control+0');
  await expect.poll(zoom).toBe('');
  expect(errors).toEqual([]);
});

test('panel sizes can be changed and are remembered', async ({ page }) => {
  const errors = await openApp(page);
  await goTo(page, 'Activity');
  await page.locator('tbody tr').first().click();
  const detail = page.getByRole('complementary', { name: 'Event details' });
  const before = (await detail.boundingBox())!.width;
  const handle = page.getByRole('separator', { name: 'Resize event details' });
  await handle.focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(async () => (await detail.boundingBox())!.width).toBeGreaterThan(before + 50);
  const after = (await detail.boundingBox())!.width;

  await page.reload();
  await goTo(page, 'Activity');
  await page.locator('tbody tr').first().click();
  await expect.poll(async () => Math.round((await detail.boundingBox())!.width)).toBe(Math.round(after));
  await page.getByRole('separator', { name: 'Resize event details' }).dblclick();
  await expect.poll(async () => Math.round((await detail.boundingBox())!.width)).toBe(Math.round(before));
  expect(errors).toEqual([]);
});
