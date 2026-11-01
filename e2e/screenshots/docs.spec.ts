import { test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const out = (name: string) => fileURLToPath(new URL(`../../docs-site/src/assets/screens/${name}.png`, import.meta.url));

async function open(page: Page, query = 'demo=static') {
  await page.goto(`/?${query}`);
  await page.locator('.splash').waitFor({ state: 'detached' });
  await page.waitForTimeout(600);
}

async function nav(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name }).click();
  await page.waitForTimeout(500);
}

async function shot(page: Page, name: string) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: out(name) });
}

test('studio', async ({ page }) => {
  await open(page);
  await shot(page, 'studio');
});

test('studio light', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+Comma');
  await page.getByRole('button', { name: 'Appearance' }).click();
  await page.getByRole('radio', { name: /Castwright Light/ }).click();
  await nav(page, 'Studio');
  await shot(page, 'studio-light');
});

test('activity', async ({ page }) => {
  await open(page);
  await nav(page, 'Activity');
  await page.locator('tbody tr').nth(3).click();
  await shot(page, 'activity');
});

test('settings', async ({ page }) => {
  await open(page);
  await nav(page, 'Settings');
  await shot(page, 'settings');
});

test('theme editor', async ({ page }) => {
  await open(page);
  await nav(page, 'Settings');
  await page.getByRole('button', { name: 'Appearance' }).click();
  await page.getByRole('button', { name: 'New theme' }).click();
  await page.locator('#theme-name').fill('Sunset');
  await page.getByRole('button', { name: 'Hue 25' }).click();
  await page.waitForTimeout(300);
  await page.locator('#appearance').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await shot(page, 'theme-editor');
});

test('first run', async ({ page }) => {
  await open(page, 'demo=static&setup');
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: 'Sign in with Twitch' }).click();
  await page.getByText('WDJB-MJHT').waitFor();
  await shot(page, 'first-run');
});

test('high contrast', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+Comma');
  await page.getByRole('button', { name: 'Appearance' }).click();
  await page.getByRole('radio', { name: /^High contrast\b(?! light)/ }).click();
  await nav(page, 'Studio');
  await shot(page, 'studio-high-contrast');
});

test('overlays', async ({ page }) => {
  await open(page);
  await nav(page, 'Overlays');
  await page.getByRole('button', { name: 'New overlay' }).first().click();
  const dlg = page.getByRole('dialog', { name: 'New overlay' });
  await dlg.getByLabel('Name').fill('Just Chatting');
  await dlg.getByText('Starter layout', { exact: true }).click();
  await dlg.getByRole('button', { name: 'Create overlay' }).click();
  await page.getByRole('button', { name: 'Back to overlays' }).click();
  await page.waitForTimeout(800);
  await shot(page, 'overlays');
});

test('overlay editor', async ({ page }) => {
  await open(page);
  await nav(page, 'Overlays');
  await page.locator('[data-overlay-card]').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('[data-layer-row]').first().click();
  await shot(page, 'overlay-editor');
});

test('overlay editor alert test', async ({ page }) => {
  await open(page);
  await nav(page, 'Overlays');
  await page.getByRole('button', { name: 'New overlay' }).first().click();
  const dlg = page.getByRole('dialog', { name: 'New overlay' });
  await dlg.getByLabel('Name').fill('Starter');
  await dlg.getByText('Starter layout', { exact: true }).click();
  await dlg.getByRole('button', { name: 'Create overlay' }).click();
  await page.getByRole('button', { name: 'Test' }).click();
  await page.getByLabel('Play an alert').selectOption('raid');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  await shot(page, 'overlay-editor-alert');
});

test('custom widget', async ({ page }) => {
  await open(page);
  await nav(page, 'Overlays');
  await page.locator('[data-overlay-card]').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Add custom widget layer' }).click();
  await page.getByRole('tablist', { name: 'Widget code' }).getByRole('tab', { name: 'JS' }).click();
  await shot(page, 'custom-widget');
});

test('alerts', async ({ page }) => {
  await open(page);
  await nav(page, 'Alerts');
  await page.getByRole('button', { name: /^Subscription/ }).click();
  await page.locator('[data-variation]').first().getByRole('button').first().click();
  await page.waitForTimeout(600);
  await shot(page, 'alerts');
});

test('automation', async ({ page }) => {
  await open(page);
  await nav(page, 'Automation');
  await page.getByText('!so', { exact: true }).first().click();
  await shot(page, 'automation');
});
