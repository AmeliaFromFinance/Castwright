import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { stubProviders } from '../providers';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
const [major, minor] = pkg.version.split('.').map(Number);
/** The demo offers the next minor version, shown without ".0". */
const next = `v${major}.${minor! + 1}`;

async function open(page: Page, query: string): Promise<string[]> {
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
  return errors;
}

async function palette(page: Page, command: string) {
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(command);
  await page.keyboard.press('Enter');
}

test('update: check, download with progress, restart after the stream', async ({ page }) => {
  const errors = await open(page, 'demo=static');
  const status = page.locator('footer.status');
  await expect(status.getByRole('button', { name: /is out/ })).toHaveCount(0);

  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Settings' }).click();
  const about = page.locator('#about');
  await about.scrollIntoViewIfNeeded();
  await expect(about.getByText('Stable', { exact: true })).toBeVisible();
  await expect(about.getByRole('switch', { name: 'Install updates automatically' })).toHaveAttribute('aria-checked', 'false');
  await about.getByRole('button', { name: 'Check for updates' }).click();

  const dialog = page.getByRole('dialog', { name: `Castwright ${next} is out` });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('One-click updates');
  await dialog.getByRole('button', { name: 'Download and install' }).click();

  const bar = dialog.getByRole('progressbar', { name: 'Downloading update' });
  await expect(bar).toBeVisible();
  await expect(dialog.getByText(/MB of 36\.6 MB · \d+%/)).toBeVisible();
  await expect(status.getByRole('button', { name: /Downloading/ })).toBeVisible();

  // The demo is live, so the restart waits.
  await expect(dialog.getByText("You're live.")).toBeVisible();
  await dialog.getByRole('button', { name: 'Restart after stream' }).click();
  await expect(dialog.getByText('Castwright restarts after the stream. It asks you first.')).toBeVisible();
  await expect(status.getByRole('button', { name: 'Update after stream' })).toBeVisible();

  // Changing your mind goes back to a plain restart button.
  await dialog.getByRole('button', { name: "Don't restart" }).click();
  await expect(dialog.getByRole('button', { name: 'Restart after stream' })).toBeVisible();

  // Restarting while live needs a second click.
  await dialog.getByRole('button', { name: 'Restart now…' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Restart while live?');
  await dialog.getByRole('button', { name: 'Restart anyway' }).click();
  await expect(page.getByText(`This is the demo. The desktop app restarts on ${next} now.`)).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(status.getByRole('button', { name: /is out|Restart/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('update: offered at start, restarts right away when not live', async ({ page }) => {
  const errors = await open(page, 'demo=static&update&ended');
  const status = page.locator('footer.status');
  await status.getByRole('button', { name: `Version ${next.slice(1)}.0 is out` }).click();
  const dialog = page.getByRole('dialog', { name: `Castwright ${next} is out` });
  await dialog.getByRole('button', { name: 'Download and install' }).click();
  await dialog.getByRole('button', { name: 'Restart to update' }).click();
  await expect(page.getByText(`This is the demo. The desktop app restarts on ${next} now.`)).toBeVisible();
  expect(errors).toEqual([]);
});

test('marker from the palette, with a note in the summary', async ({ page }) => {
  const errors = await open(page, 'demo=static');
  await palette(page, 'add stream marker');

  const toast = page.getByRole('status', { name: 'Marker added' });
  await expect(toast).toContainText(/Marker 4 · \d:\d\d:\d\d added/);
  await toast.getByRole('textbox', { name: 'Marker note' }).fill('Boss fight starts');
  // Typing keeps the toast open past its usual 10 seconds.
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await expect(page.getByText('Note saved')).toBeVisible();
  await expect(toast).toBeHidden();

  await palette(page, 'last stream summary');
  const markers = page.getByRole('dialog', { name: 'Stream summary' }).getByRole('region', { name: 'Markers' });
  await expect(markers.getByRole('listitem')).toHaveCount(4);
  await expect(markers.getByRole('listitem').last()).toContainText('Boss fight starts');
  await expect(markers).toContainText('Clutch round');
  expect(errors).toEqual([]);
});

test('clip from the palette: toast with the link, copy and open', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors = await open(page, 'demo=static');
  await palette(page, 'create clip');

  await expect(page.getByRole('status', { name: 'Making a clip' })).toContainText('Making a clip…');
  const toast = page.getByRole('status', { name: 'Clip ready' });
  await expect(toast).toContainText('clips.twitch.tv/DemoClipNew1');
  await toast.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByText('Clip link copied')).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('https://clips.twitch.tv/DemoClipNew1');

  await context.route('https://clips.twitch.tv/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: 'clip' }));
  const popup = page.waitForEvent('popup');
  await toast.getByRole('button', { name: 'Open' }).click();
  const opened = await popup;
  await opened.waitForLoadState();
  expect(opened.url()).toBe('https://clips.twitch.tv/DemoClipNew1');
  await opened.close();

  await palette(page, 'last stream summary');
  const clips = page.getByRole('dialog', { name: 'Stream summary' }).getByRole('region', { name: 'Clips' });
  await expect(clips.getByRole('listitem')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('markers and clips need a live stream', async ({ page }) => {
  await open(page, 'demo=static&ended');
  await palette(page, 'add stream marker');
  await expect(page.getByRole('alert').filter({ hasText: "Markers only work while you're live." })).toBeVisible();
  await palette(page, 'create clip');
  await expect(page.getByRole('alert').filter({ hasText: "Clips only work while you're live." })).toBeVisible();
});
