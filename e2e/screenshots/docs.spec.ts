import { test, type Page } from '@playwright/test';
import { fixture, stubProviders } from '../providers';
import { fileURLToPath } from 'node:url';

const out = (name: string) => fileURLToPath(new URL(`../../docs-site/src/assets/screens/${name}.png`, import.meta.url));

/** Emote lists and 7TV styles come from saved data; the images themselves are real. */
async function providers(page: Page) {
  await stubProviders(page, {
    seventvGlobal: fixture('7tv-global'),
    seventvUser: fixture('7tv-user'),
    bttvGlobal: fixture('bttv-global'),
    bttvUser: fixture('bttv-user'),
    ffzGlobal: fixture('ffz-global'),
    ffzRoom: fixture('ffz-room'),
    styles: {
      '1000': { paint: '01JHXJFACX42RV996VE9933TB8', badge: '01JJJ74CRHZBRMCM8F4Y2WBN6R' },
      '1002': { paint: '01GHA42XER0001KT343YQ6DM2E' },
      '1005': { paint: '01HQE7KJWG0000D7GK7EKRAPN3', badge: '01GAF8RWW8000E8VNG1S1RMTBA' },
      '1003': { badge: '01GAF8RWW8000E8VNG1S1RMTBA' }
    },
    cosmetics: fixture('7tv-cosmetics')
  });
  if (process.env.HTTPS_PROXY) {
    await page.unroute(/^https:\/\/cdn\.(7tv\.app|betterttv\.net|frankerfacez\.com)\//);
    await page.unroute('https://static-cdn.jtvnw.net/badges/**');
  }
}

async function open(page: Page, query = 'demo=static') {
  await providers(page);
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


test('light theme', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+Comma');
  await page.getByRole('button', { name: 'Appearance' }).click();
  await page.getByRole('radio', { name: /Castwright Light/ }).click();
  await nav(page, 'Overlays');
  await page.locator('[data-overlay-card]').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await shot(page, 'light-theme');
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
  await nav(page, 'Alerts');
  await shot(page, 'high-contrast');
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
  await page.getByText('Big raid welcome', { exact: true }).first().click();
  await page.waitForTimeout(600);
  await shot(page, 'automation');
});

test('automation list view', async ({ page }) => {
  await open(page);
  await nav(page, 'Automation');
  await page.getByText('Count deaths', { exact: true }).first().click();
  await page.getByRole('radio', { name: 'List' }).click();
  await shot(page, 'automation-list');
});

test('chat with 7TV', async ({ page }) => {
  await open(page);
  await nav(page, 'Activity');
  await page.getByRole('radio', { name: 'Chat' }).click();
  await page.waitForTimeout(2500);
  await shot(page, 'chat');
});

test('comic chat cards', async ({ page }) => {
  await open(page);
  await nav(page, 'Overlays');
  await page.locator('[data-overlay-card]').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('[data-layer-row]').filter({ hasText: 'Chat' }).locator('.pick').click();
  await page.getByRole('button', { name: /^Cards/ }).click();
  await page.getByRole('list', { name: 'Styles' }).first().getByRole('button', { name: /^Comic style/ }).click();
  await page.waitForTimeout(2500);
  await shot(page, 'styles');
});

test('alert styles', async ({ page }) => {
  await open(page);
  await nav(page, 'Alerts');
  await page.getByRole('button', { name: /^Follow/ }).click();
  const card = page.locator('[data-variation]').first();
  const styles = card.getByRole('button', { name: 'Styles', exact: true });
  if (!(await styles.isVisible())) await card.locator('button.expand').click();
  await styles.click();
  await card.getByRole('button', { name: /^Neon style/ }).click();
  await page.getByText('Styles', { exact: true }).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  await shot(page, 'alert-styles');
});

test('command palette', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('test');
  await shot(page, 'palette');
});
