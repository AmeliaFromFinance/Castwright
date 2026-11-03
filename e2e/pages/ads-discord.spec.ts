import { expect, test, type Page } from '@playwright/test';
import { stubProviders } from '../providers';

let errors: string[] = [];
let consoleInfo: string[] = [];

async function open(page: Page, query = 'demo=static') {
  errors = [];
  consoleInfo = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    if (m.type() === 'info') consoleInfo.push(m.text());
  });
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await stubProviders(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?${query}`, { timeout: 90_000 });
  await expect(page.locator('.splash')).toHaveCount(0);
}

test.afterEach(() => {
  expect(errors, 'no page or console errors').toEqual([]);
});

test('snooze the next ad and run one from the status bar', async ({ page }) => {
  await open(page);
  const status = page.getByRole('contentinfo', { name: 'Status' });
  const item = status.getByRole('button', { name: /^Ad in 4:\d\d$/ });
  await expect(item).toBeVisible();
  await item.click();
  const pop = page.getByTestId('ad-popover');
  await expect(pop.getByText(/^in 4:\d\d$/)).toBeVisible();
  await expect(pop.getByText('Snoozes left')).toBeVisible();
  await expect(pop.getByTestId('ad-snoozes')).toHaveText('2');
  await expect(pop.getByText('Preroll-free time')).toBeVisible();
  await expect(pop.locator('dt', { hasText: 'Preroll-free time' }).locator('+ dd')).toHaveText('7:00');

  await pop.getByRole('button', { name: 'Snooze 5 min' }).click();
  await expect(page.getByText('Snoozed. 1 snooze left.')).toBeVisible();
  await expect(status.getByRole('button', { name: /^Ad in 9:\d\d$/ })).toBeVisible();
  await expect(pop.getByTestId('ad-snoozes')).toHaveText('1');

  await pop.getByRole('combobox', { name: 'Ad length' }).selectOption('30');
  await pop.getByRole('button', { name: 'Run ad now' }).click();
  await expect(page.getByText('Starting a 30 s ad')).toBeVisible();
  await expect(status.getByRole('button', { name: /^Ad running 0:[23]\d$/ })).toBeVisible();
  await expect(pop.getByRole('button', { name: 'Snooze 5 min' })).toBeDisabled();
  await expect(pop.getByText('Your scenes stay as they are.', { exact: false })).toBeVisible();
});

test('a heads-up before the ad offers a snooze', async ({ page }) => {
  await open(page, 'ads=soon');
  const toast = page.getByRole('status').filter({ hasText: /Ad break in 0:[12]\d, 1:30 long\./ });
  await expect(toast).toBeVisible({ timeout: 10_000 });
  await toast.getByRole('button', { name: 'Snooze' }).click();
  await expect(page.getByText('Snoozed. 1 snooze left.')).toBeVisible();
  await expect(page.getByRole('contentinfo', { name: 'Status' }).getByRole('button', { name: /^Ad in 5:\d\d$/ })).toBeVisible();
});

test('the ad break layer in the editor', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Overlays', exact: true }).click();
  await page.locator('[data-overlay-card]').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Add ad break layer' }).click();
  const layer = page.locator('.cw-stage [data-layer-type="ad_break"]');
  await expect(layer.locator('.cw-ad-text')).toHaveText(/^Ads in 0:\d\d, back soon$/);
  await expect(layer.locator('.cw-ad')).toHaveClass(/cw-ad-soon/);

  await page.getByRole('radio', { name: 'During the ad' }).click();
  await expect(layer.locator('.cw-ad-text')).toHaveText(/^Thanks for sticking around! Back in \d:\d\d$/);
  await expect(layer.locator('.cw-ad')).toHaveClass(/cw-ad-running/);

  await page.getByRole('textbox', { name: 'During the ad' }).fill('Ad break, {{time}} to go');
  await expect(layer.locator('.cw-ad-text')).toHaveText(/^Ad break, \d:\d\d to go$/);

  await page.getByRole('button', { name: /^Cards/ }).click();
  await expect(page.getByText('The message')).toBeVisible();
  const before = await layer.locator('.cw-ad-card').evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.locator('[data-preset="comic"]').first().click();
  await expect.poll(() => layer.locator('.cw-ad-card').evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(before);
});

test('Discord settings: preview, test post and a new webhook', async ({ page }) => {
  await open(page);
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Discord', exact: true }).click();
  const hook = page.locator('[data-webhook="demo-hook"]');
  await expect(hook).toBeVisible();
  await expect(hook.getByTestId('live-preview')).toHaveText('<@&112233445566778899> Castwright is live with Just Chatting! Come hang out.');
  await expect(hook.getByPlaceholder(/^Saved/)).toBeVisible();

  await hook.getByRole('button', { name: 'Send test' }).click();
  await expect(page.getByText('Test sent to #stream-alerts')).toBeVisible();
  const payload = consoleInfo.find((t) => t.includes('Discord payload'));
  expect(payload).toBeTruthy();
  expect(payload).toContain('"allowed_mentions"');
  expect(payload).toContain('live_user_castwright-1280x720.jpg?t=');

  // Only the chosen mention pings: switch to nobody and the preview drops it.
  await hook.getByRole('radio', { name: 'Nobody' }).click();
  await expect(hook.getByTestId('live-preview')).toHaveText('Castwright is live with Just Chatting! Come hang out.');
  await hook.getByRole('button', { name: 'Save' }).click();
  await expect(hook.getByRole('button', { name: 'Save' })).toBeDisabled();

  await page.getByRole('button', { name: 'Add webhook' }).click();
  const fresh = page.locator('[data-webhook]').nth(1);
  await expect(fresh.getByRole('button', { name: 'Send test' })).toBeDisabled();
  await fresh.getByLabel('Name').fill('#going-live');
  const link = fresh.getByLabel('Webhook link');
  await link.fill('https://example.com/hook');
  await expect(fresh.getByText("That isn't a Discord webhook link.")).toBeVisible();
  await link.fill('https://discord.com/api/webhooks/123456789/abcDEF_ghi-123');
  await fresh.getByRole('radio', { name: 'A role' }).click();
  await fresh.getByLabel('Role mention').fill('@mods');
  await expect(fresh.getByText('Use a role mention like')).toBeVisible();
  await fresh.getByLabel('Role mention').fill('987654321');
  await fresh.getByRole('button', { name: 'Save' }).click();
  await expect(fresh.getByPlaceholder(/^Saved/)).toBeVisible();
  await expect(fresh.getByLabel('Role mention')).toHaveValue('<@&987654321>');
  await fresh.getByRole('button', { name: 'Send test' }).click();
  await expect(page.getByText('Test sent to #going-live')).toBeVisible();

  await fresh.getByRole('button', { name: 'Remove' }).click();
  await fresh.getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('[data-webhook]')).toHaveCount(1);
});
