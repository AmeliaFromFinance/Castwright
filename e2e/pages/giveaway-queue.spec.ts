import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubProviders } from '../providers';

const screens = join(dirname(fileURLToPath(import.meta.url)), '__screens__');
let errors: string[] = [];

test.beforeAll(() => mkdirSync(screens, { recursive: true }));

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await stubProviders(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?demo=static', { timeout: 90_000 });
  await expect(page.locator('.splash')).toHaveCount(0);
});

test.afterEach(() => {
  expect(errors, 'no page or console errors').toEqual([]);
});

async function openTab(page: Page, tab: 'Giveaways' | 'Queue') {
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Interact' }).click();
  await page.getByRole('radio', { name: tab, exact: true }).click();
}

test('run a giveaway: open, entries arrive, draw, re-roll', async ({ page }) => {
  await openTab(page, 'Giveaways');
  const form = page.getByRole('form', { name: 'New giveaway' });
  await form.getByLabel('Prize').fill('');
  await form.getByRole('button', { name: 'Open giveaway' }).click();
  await expect(form.getByText('Say what the prize is.')).toBeVisible();
  await form.getByLabel('Prize').fill('Mechanical keyboard');
  await form.getByRole('radio', { name: 'Subs' }).click();
  await form.getByRole('radio', { name: 'Everyone' }).click();
  await form.getByLabel('Entries per sub').fill('2');
  await form.getByRole('button', { name: 'Open giveaway' }).click();

  const live = page.getByRole('region', { name: 'Running giveaway' });
  await expect(live.getByRole('heading', { name: 'Mechanical keyboard' })).toBeVisible();
  await expect(live.getByText('Open', { exact: true })).toBeVisible();
  // Demo viewers type !join over the next few seconds.
  await expect.poll(async () => Number(await live.getByTestId('gw-count').textContent()), { timeout: 15_000 }).toBeGreaterThanOrEqual(8);
  const list = live.getByRole('list', { name: 'Entrant list' });
  await expect(list.getByText('nova_kat')).toBeVisible();
  await live.getByLabel('Search entrants').fill('nova');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await live.getByLabel('Search entrants').fill('');

  // Remove one, then close entries.
  await list.getByRole('button', { name: 'Remove raiding_rudy' }).click();
  await expect(list.getByText('raiding_rudy')).toHaveCount(0);
  await live.getByRole('button', { name: 'Close entries' }).click();
  await expect(live.getByText('Closed', { exact: true })).toBeVisible();

  await live.getByRole('button', { name: 'Draw winner' }).click();
  const winners = live.getByRole('article');
  await expect(winners).toHaveCount(1);
  await expect(winners.first().getByText(/s to claim|Claimed/)).toBeVisible();
  const first = (await winners.first().locator('.name').textContent())!.trim();

  await winners.first().getByRole('button', { name: 'Re-roll' }).click();
  await expect(winners).toHaveCount(2);
  await expect(live.getByRole('article', { name: `Winner ${first}` }).getByText('Re-rolled')).toBeVisible();
  const second = live.getByRole('article').first();
  await expect(second.locator('.name')).not.toHaveText(first);
  // Demo winners often chat back and claim on their own.
  const mark = second.getByRole('button', { name: 'Mark claimed' });
  if (await mark.isVisible()) await mark.click({ timeout: 2000 }).catch(() => {});
  await expect(second.getByText('Claimed')).toBeVisible();
  await page.screenshot({ path: join(screens, 'giveaway-live.png') });

  await live.getByRole('button', { name: 'Done' }).click();
  const history = page.getByRole('region', { name: 'Past giveaways' });
  await expect(history.getByText('Mechanical keyboard')).toBeVisible();
  await expect(page.getByRole('form', { name: 'New giveaway' })).toBeVisible();
});

test('queue: viewers join, reorder, next', async ({ page }) => {
  await openTab(page, 'Queue');
  const q = page.getByRole('region', { name: 'Viewer queue' });
  await expect(q.getByText('Open the queue to let viewers join.')).toBeVisible();
  await q.getByRole('switch', { name: 'Queue open' }).click();
  const line = q.getByRole('list', { name: 'In line list' });
  await expect.poll(() => line.getByRole('listitem').count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(4);
  const ids = async () => line.getByRole('listitem').evaluateAll((els) => els.map((e) => e.getAttribute('data-user-id')));
  const before = await ids();

  // Drag the third person to the top.
  await line.getByRole('listitem').nth(2).dragTo(line.getByRole('listitem').nth(0));
  await expect.poll(ids).toEqual(expect.arrayContaining([before[2], before[0], before[1]]));
  expect((await ids()).slice(0, 3)).toEqual([before[2], before[0], before[1]]);

  // And back down with the buttons.
  const name = (await line.getByRole('listitem').first().locator('.name').textContent())!.trim();
  await line.getByRole('button', { name: `Move ${name} down` }).click();
  await expect.poll(async () => (await ids()).slice(0, 2)).toEqual([before[0], before[2]]);

  // A note, then Next pulls in a party of two.
  await line.getByRole('listitem').first().locator('.note').click();
  await line.getByRole('textbox').fill('Main#0001');
  await line.getByRole('textbox').press('Enter');
  await expect(line.getByRole('listitem').first()).toContainText('Main#0001');

  await q.getByRole('button', { name: /^Next/ }).click();
  const playing = q.getByRole('group', { name: 'Playing now' });
  await expect(playing.getByRole('listitem')).toHaveCount(2);
  await expect(playing.getByRole('listitem').first()).toContainText('Main#0001');
  await page.screenshot({ path: join(screens, 'queue.png') });

  await q.getByRole('button', { name: 'Clear' }).click();
  await expect(playing.getByRole('listitem')).toHaveCount(0);
});

test('a clashing word shows a warning while a giveaway is open', async ({ page }) => {
  await openTab(page, 'Giveaways');
  await page.getByRole('form', { name: 'New giveaway' }).getByRole('button', { name: 'Open giveaway' }).click();
  await expect(page.getByRole('region', { name: 'Running giveaway' })).toBeVisible();
  await page.getByRole('radio', { name: 'Queue', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'The giveaway uses !join too' })).toBeVisible();
  const settings = page.getByRole('form', { name: 'Queue settings' });
  await settings.getByLabel('Join', { exact: true }).fill('!play');
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'The giveaway uses' })).toHaveCount(0);
});

test('giveaway and queue layers in the editor', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Overlays' }).click();
  await page.locator('[data-overlay-card]').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Add giveaway layer' }).click();
  const gw = page.locator('.cw-stage .cw-gw');
  await expect(gw.locator('.cw-gw-winner-name')).toHaveText('nova_kat');
  await page.getByRole('button', { name: 'Spin the sample' }).click();
  await expect(gw.locator('.cw-gw-window[data-phase="spinning"]')).toBeVisible();
  await expect(gw.locator('.cw-gw-window[data-phase="landed"]')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Add viewer queue layer' }).click();
  await expect(page.locator('.cw-stage .cw-q-item')).toHaveCount(7);
});
