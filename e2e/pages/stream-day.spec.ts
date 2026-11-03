import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubProviders } from '../providers';

const screens = join(dirname(fileURLToPath(import.meta.url)), '__screens__');

test.beforeAll(() => {
  mkdirSync(screens, { recursive: true });
});

async function open(page: Page): Promise<string[]> {
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
  return errors;
}

const status = (page: Page) => page.getByRole('contentinfo', { name: 'Status' });

test('alert controls in the status bar', async ({ page }) => {
  const errors = await open(page);
  const trigger = status(page).getByRole('button', { name: /^Alert controls/ });
  await expect(trigger).toHaveText('Alerts');

  await trigger.click();
  const pop = page.getByRole('dialog', { name: 'Alert controls' });
  await expect(pop).toBeVisible();
  await expect(pop.getByRole('button', { name: 'Skip current' })).toBeDisabled();
  await expect(pop.getByRole('button', { name: 'Replay last' })).toBeDisabled();

  await pop.getByRole('button', { name: 'Pause alerts' }).click();
  await expect(trigger).toHaveText('Paused');
  await expect(pop.getByRole('button', { name: 'Resume alerts' })).toBeVisible();

  // A test alert waits while paused.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('test follow alert');
  await page.keyboard.press('Enter');
  await expect(trigger).toContainText('Paused');
  await expect(trigger.locator('.count')).toHaveText('1');

  await trigger.click();
  await pop.getByRole('button', { name: 'Mute alert sound' }).click();
  await expect(pop.getByRole('button', { name: 'Unmute alert sound' })).toHaveAttribute('aria-pressed', 'true');
  await expect(trigger).toHaveAttribute('title', 'Alerts paused and muted, 1 alert queued');
  await page.screenshot({ path: join(screens, 'alert-controls.png') });

  await pop.getByRole('button', { name: 'Resume alerts' }).click();
  await expect(pop.getByRole('button', { name: 'Skip current' })).toBeEnabled();
  await expect(pop.getByText('1 waiting')).toHaveCount(0);
  await pop.getByRole('button', { name: 'Skip current' }).click();
  await expect(pop.getByRole('button', { name: 'Replay last' })).toBeEnabled();
  await pop.getByRole('button', { name: 'Replay last' }).click();
  await expect(pop.getByRole('button', { name: 'Skip current' })).toBeEnabled();

  await pop.getByRole('button', { name: 'Unmute alert sound' }).click();
  await expect(trigger).toHaveAttribute('title', /^Alerts, /);
  await pop.getByRole('button', { name: 'Open alerts page' }).click();
  await expect(pop).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'Alerts' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('alert commands in the palette', async ({ page }) => {
  const errors = await open(page);
  const search = page.getByRole('combobox', { name: 'Search commands' });
  await page.keyboard.press('Control+k');
  await search.fill('mute alert sound');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Alert sound muted')).toBeVisible();
  await expect(status(page).getByRole('button', { name: /^Alert controls/ })).toHaveText('Muted');

  await page.keyboard.press('Control+k');
  await search.fill('replay the last alert');
  await page.keyboard.press('Enter');
  await expect(page.getByText('No alert has played yet.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('go-live check: results, fixes and your own list', async ({ page }) => {
  const errors = await open(page);
  const trigger = status(page).getByRole('button', { name: /^Alert controls/ });
  await trigger.click();
  await page.getByRole('dialog', { name: 'Alert controls' }).getByRole('button', { name: 'Pause alerts' }).click();
  await page.getByRole('dialog', { name: 'Alert controls' }).getByRole('button', { name: 'Mute alert sound' }).click();
  await page.keyboard.press('Escape');

  await status(page).getByRole('button', { name: 'Go-live check' }).click();
  const dlg = page.getByRole('dialog', { name: 'Go-live check' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole('status')).toHaveText('1 problem, 1 warning');
  const rows = dlg.getByRole('list', { name: 'Checks' }).getByRole('listitem');
  await expect(rows.first()).toHaveAttribute('data-check', 'alerts_paused');
  await expect(rows.nth(1)).toHaveAttribute('data-check', 'alerts_muted');
  await expect(dlg.locator('[data-check="obs"]')).toContainText('Connected to OBS');
  await expect(dlg.locator('[data-check="overlay:Castwright · Gameplay HUD"]')).toContainText('Gameplay HUD in OBS');

  await dlg.getByRole('checkbox', { name: 'Mic on and not muted' }).check();
  await expect(dlg.getByText('1 of 2 done')).toBeVisible();
  await page.screenshot({ path: join(screens, 'golive-check.png') });

  await dlg.locator('[data-check="alerts_paused"]').getByRole('button', { name: 'Resume' }).click();
  await dlg.locator('[data-check="alerts_muted"]').getByRole('button', { name: 'Unmute' }).click();
  await expect(dlg.getByRole('status')).toHaveText('All good');
  await expect(trigger).toHaveText('Alerts');

  await dlg.getByRole('button', { name: 'Done' }).click();
  await expect(dlg).toHaveCount(0);
  await expect(status(page).getByRole('button', { name: 'Go-live check' }).locator('.dot.ok')).toBeVisible();

  // Ticks survive closing; the list is edited in Settings.
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('go-live check');
  await page.keyboard.press('Enter');
  await expect(dlg.getByRole('checkbox', { name: 'Mic on and not muted' })).toBeChecked();
  await dlg.getByRole('button', { name: 'Edit list' }).click();
  await expect(dlg).toHaveCount(0);
  const section = page.locator('section#golive');
  await expect(section).toBeInViewport();
  await section.getByRole('textbox', { name: 'New checklist item' }).fill('Phone on silent');
  await section.getByRole('button', { name: 'Add' }).click();
  await expect(section.getByRole('textbox', { name: 'Checklist item', exact: true })).toHaveCount(3);
  await section.getByRole('button', { name: 'Remove Water bottle filled' }).click();
  await expect(section.getByRole('textbox', { name: 'Checklist item', exact: true })).toHaveCount(2);
  await section.getByRole('switch', { name: 'Open when the stream starts' }).click();
  await expect(section.getByRole('switch', { name: 'Open when the stream starts' })).toHaveAttribute('aria-checked', 'false');
  await page.screenshot({ path: join(screens, 'golive-settings.png') });

  await status(page).getByRole('button', { name: 'Go-live check' }).click();
  await expect(dlg.getByRole('checkbox')).toHaveCount(2);
  await expect(dlg.getByRole('checkbox', { name: 'Phone on silent' })).toBeVisible();
  expect(errors).toEqual([]);
});
