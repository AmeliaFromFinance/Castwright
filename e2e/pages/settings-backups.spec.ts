import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubProviders } from '../providers';

const screens = join(dirname(fileURLToPath(import.meta.url)), '__screens__');

test('settings backups: back up, restore, delete and keep counts', async ({ page }) => {
  mkdirSync(screens, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || (m.type() === 'warning' && m.text().includes('[svelte]'))) errors.push(`console: ${m.text()}`);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await stubProviders(page);
  await page.goto('/?demo=static');
  await expect(page.locator('.splash')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Settings' }).click();

  const name = page.locator('#project-name');
  const original = await name.inputValue();
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Backups and data' }).click();
  const section = page.locator('#backups');
  const rows = section.getByRole('table', { name: 'Backups' }).locator('tbody tr');
  await expect(rows).toHaveCount(4);

  await section.getByRole('button', { name: 'Back up now' }).click();
  await expect(page.getByText('Nothing changed since the last backup')).toBeVisible();
  await expect(rows).toHaveCount(4);

  await name.fill('Broken show');
  await name.press('Enter');
  await expect(page.getByText('Project renamed')).toBeVisible();
  await section.getByRole('button', { name: 'Back up now' }).click();
  await expect(page.getByText('Backup saved')).toBeVisible();
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toContainText('Back up now');
  await expect(rows.first()).toContainText('Broken show');

  // Restore the backup made at start-up.
  await rows.filter({ hasText: 'App start' }).getByRole('button', { name: /^Restore backup from/ }).click();
  const confirm = page.getByRole('dialog', { name: 'Restore this backup?' });
  await expect(confirm).toContainText('backed up first');
  await confirm.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('Backup restored')).toBeVisible();
  await expect(name).toHaveValue(original);
  // "Broken show" didn't change since the manual backup, so no extra copy was needed.
  await expect(rows).toHaveCount(5);

  const toasts = page.locator('.toast');
  while ((await toasts.count()) > 0) await toasts.first().getByRole('button', { name: 'Dismiss' }).click();
  await section.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Backups and data' })).toHaveAttribute(
    'aria-current',
    'true'
  );
  await page.mouse.move(0, 0);
  await page.screenshot({ path: join(screens, 'settings-backups.png') });

  await rows.first().getByRole('button', { name: /^Delete backup from/ }).click();
  await page.getByRole('dialog', { name: 'Delete this backup?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Backup deleted')).toBeVisible();
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).not.toContainText('Broken show');

  // One daily backup left: the newest. The other kinds are counted separately.
  const daily = section.getByLabel('Daily backups to keep');
  await daily.fill('1');
  await daily.dispatchEvent('change');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('App start');
  await expect(rows.nth(1)).toContainText('Before restore');

  // Saving files and opening folders only works in the desktop app.
  await section.getByRole('button', { name: 'Restore from file…' }).click();
  await expect(page.getByText('Restoring from a file needs the desktop app')).toBeVisible();
  expect(errors).toEqual([]);
});
