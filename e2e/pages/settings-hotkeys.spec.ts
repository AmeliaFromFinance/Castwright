import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubProviders } from '../providers';

const screens = join(dirname(fileURLToPath(import.meta.url)), '__screens__');

test('settings hotkeys: record, conflicts, clear, action rows and the switch', async ({ page }) => {
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
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Hotkeys' }).click();

  const section = page.locator('#hotkeys');
  await expect(section.getByText('only work in the desktop app')).toBeVisible();
  const items = section.getByRole('listitem');
  await expect(items).toHaveCount(8);
  const recorder = (name: string) => section.getByRole('button', { name: new RegExp(`^Hotkey for ${name}:`) });

  // Record a new combo.
  await recorder('Open the go-live check').click();
  await expect(section.getByText('Esc cancels · Backspace clears')).toBeVisible();
  await page.keyboard.press('Control+Alt+KeyG');
  await expect(recorder('Open the go-live check')).toHaveAccessibleName(/Ctrl\+Alt\+G/);
  await expect(section.getByText('Esc cancels')).toHaveCount(0);

  // A combo another row uses is refused, and Esc keeps the old one.
  await recorder('Skip alert').click();
  await page.keyboard.press('Control+Alt+KeyR');
  await expect(section.getByText('Ctrl + Alt + R is already used for "Replay last alert".')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(recorder('Skip alert')).toHaveAccessibleName(/Ctrl\+Alt\+S/);

  // Keys that would break typing, or that the app window uses, are refused too.
  await recorder('Skip alert').click();
  await page.keyboard.press('KeyR');
  await expect(section.getByText('Add Ctrl, Alt or Super so normal typing keeps working.')).toBeVisible();
  await page.keyboard.press('Control+KeyK');
  await expect(section.getByText('Castwright uses Ctrl + K inside the app.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Backspace clears, and so does the X button.
  await recorder('Replay last alert').click();
  await page.keyboard.press('Backspace');
  await expect(recorder('Replay last alert')).toHaveAccessibleName(/not set/);
  await section.getByRole('button', { name: 'Clear hotkey for Pause or resume alerts' }).click();
  await expect(recorder('Pause or resume alerts')).toHaveAccessibleName(/not set/);

  // The keyboard alone can start recording.
  await recorder('Mute or unmute alerts').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+Shift+KeyM');
  await expect(recorder('Mute or unmute alerts')).toHaveAccessibleName(/Ctrl\+Shift\+M/);

  // A hotkey for an automation action.
  await section.getByRole('button', { name: 'Add action hotkey' }).click();
  await expect(items).toHaveCount(9);
  await items.last().getByLabel('Action to run').selectOption({ label: '!uptime' });
  await recorder('Run "!uptime"').click();
  await page.keyboard.press('Control+Alt+KeyU');
  await expect(recorder('Run "!uptime"')).toHaveAccessibleName(/Ctrl\+Alt\+U/);

  const toasts = page.locator('.toast');
  while ((await toasts.count()) > 0) await toasts.first().getByRole('button', { name: 'Dismiss' }).click();
  await section.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.mouse.move(0, 0);
  await page.screenshot({ path: join(screens, 'settings-hotkeys.png') });

  // Removing the row and switching everything off.
  await section.getByRole('button', { name: 'Remove Run "!uptime"' }).click();
  await expect(items).toHaveCount(8);
  const all = section.getByRole('switch', { name: 'Use global hotkeys' });
  await all.click();
  await expect(all).toHaveAttribute('aria-checked', 'false');

  // Saved: leaving and coming back shows the same list.
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Overlays' }).click();
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Settings' }).click();
  await expect(recorder('Open the go-live check')).toHaveAccessibleName(/Ctrl\+Alt\+G/);
  await expect(recorder('Replay last alert')).toHaveAccessibleName(/not set/);
  await expect(section.getByRole('switch', { name: 'Use global hotkeys' })).toHaveAttribute('aria-checked', 'false');
  expect(errors).toEqual([]);
});

test('settings about: portable mode needs the desktop app', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubProviders(page);
  await page.goto('/?demo=static');
  await expect(page.locator('.splash')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Settings' }).click();
  const about = page.locator('#about');
  await expect(about.getByText('Only available in the desktop app.')).toBeVisible();
  await expect(about.getByRole('button', { name: 'Make portable…' })).toBeDisabled();
  await about.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: join(screens, 'settings-about.png') });
});
