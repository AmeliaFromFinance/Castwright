import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp } from './helpers';

const DEMO_TOKEN = 'demo0123456789abcdef0123456789ab';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test('health opens from the status bar and shows every section', async ({ page }) => {
  const errors = await openApp(page);
  const icon = page.getByRole('contentinfo', { name: 'Status' }).getByRole('button', { name: /^Health:/ });
  await expect(icon).toHaveAttribute('title', /Health: 2 warnings/);
  await expect(icon).toHaveClass(/warn/);
  await icon.click();

  const dialog = page.getByRole('dialog', { name: 'Health' });
  await expect(dialog.getByRole('status')).toHaveText('2 warnings');
  for (const name of ['Overlays', 'OBS', 'Twitch', 'App', 'Recent problems']) {
    await expect(dialog.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await expect(dialog.getByText('OBS 32, Chrome')).toBeVisible();
  await expect(dialog.getByText('channel.hype_train.begin', { exact: true })).toBeVisible();
  await expect(dialog.getByText('27 of 28 active')).toBeVisible();

  await dialog.getByRole('button', { name: /^Reload / }).first().click();
  await expect(page.getByText(/^Reloaded /)).toBeVisible();
  expect(errors).toEqual([]);
});

test('a problem can be filtered and copied', async ({ page }) => {
  const errors = await openApp(page);
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('health');
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Health' });
  const problems = dialog.getByRole('list', { name: 'Recent warnings and errors' }).getByRole('listitem');
  await expect(problems).toHaveCount(3);
  await dialog.getByRole('combobox', { name: 'Filter by source' }).selectOption('automation');
  await expect(problems).toHaveCount(1);
  await problems.first().getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByText('Copied')).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/^\d{4}-\d\d-\d\dT.* WARN \[automation\] "Count deaths" ran too many times/);
  expect(errors).toEqual([]);
});

test('the demo saves a bug report without secrets', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('contentinfo', { name: 'Status' }).getByRole('button', { name: /^Health:/ }).click();
  await page.getByRole('dialog', { name: 'Health' }).getByRole('button', { name: 'Save bug report…' }).click();

  const dialog = page.getByRole('dialog', { name: 'Save a bug report' });
  const files = dialog.getByRole('list', { name: 'Files in the report' });
  await expect(files).toContainText('settings.json');
  await expect(files).not.toContainText('project.json');
  await expect(dialog.getByText('Nothing is uploaded.', { exact: false })).toBeVisible();
  await dialog.getByRole('checkbox', { name: /Include project/ }).check();
  await expect(files).toContainText('project.json');

  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Save bug report…' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^castwright-bug-report-\d+\.\d+\.\d+-\d{4}-\d\d-\d\d\.zip$/);
  const zip = readFileSync(await file.path()).toString('latin1');
  expect(zip.startsWith('PK')).toBe(true);
  for (const name of ['README.txt', 'health.json', 'settings.json', 'log.txt', 'project.json']) expect(zip).toContain(name);
  expect(zip).not.toContain(DEMO_TOKEN);
  await expect(page.getByText('Bug report saved')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('after a crash the app offers a bug report', async ({ page }) => {
  const errors = await openApp(page, 'demo=static&crashed');
  const prompt = page.getByRole('dialog', { name: 'Castwright closed unexpectedly last time' });
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button', { name: 'Save bug report…' }).click();
  await expect(page.getByRole('dialog', { name: 'Save a bug report' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('settings about opens health and the bug report', async ({ page }) => {
  const errors = await openApp(page);
  await page.keyboard.press('Control+,');
  const about = page.locator('#about');
  await about.getByRole('button', { name: 'Health' }).click();
  await expect(page.getByRole('dialog', { name: 'Health' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Health' }).getByRole('button', { name: 'Done' }).click();
  await about.getByRole('button', { name: 'Save bug report…' }).click();
  await expect(page.getByRole('dialog', { name: 'Save a bug report' })).toBeVisible();
  expect(errors).toEqual([]);
});
