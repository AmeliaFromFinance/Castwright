import { expect, test } from '@playwright/test';
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
