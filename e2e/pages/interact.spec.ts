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

async function openInteract(page: Page, tab: 'Channel points' | 'Polls & predictions') {
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Interact' }).click();
  await expect(page.getByRole('heading', { name: 'Interact', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: tab, exact: true }).click();
}

test('create a reward and work through the redemption queue', async ({ page }) => {
  await openInteract(page, 'Channel points');
  const rewards = page.getByRole('region', { name: 'Rewards' });
  await expect(rewards.locator('[data-reward="Hydrate"]')).toBeVisible();
  // Rewards made on Twitch are shown, but can't be changed.
  const twitchMade = rewards.locator('[data-reward="Highlight My Message"]');
  await expect(twitchMade).toBeVisible();
  await expect(twitchMade.getByRole('button')).toHaveCount(0);
  await expect(rewards.getByText('Twitch only lets an app change rewards it made.')).toBeVisible();
  await page.screenshot({ path: join(screens, 'interact-rewards.png') });

  await page.getByRole('button', { name: 'New reward' }).click();
  const dialog = page.getByRole('dialog', { name: 'New reward' });
  await dialog.getByRole('button', { name: 'Create reward' }).click();
  await expect(dialog.getByText('Give the reward a title.')).toBeVisible();
  await dialog.getByLabel('Title').fill('Stretch break');
  await dialog.getByLabel('Cost in points').fill('750');
  await dialog.getByLabel('Cooldown in seconds').fill('600');
  await dialog.getByRole('button', { name: 'Create reward' }).click();
  await expect(dialog).toHaveCount(0);
  const created = rewards.locator('[data-reward="Stretch break"]');
  await expect(created).toContainText('750');
  await expect(created).toContainText('Cooldown 10 min');

  // Pause it, then delete it.
  await created.getByRole('button', { name: 'Pause Stretch break' }).click();
  await expect(created).toContainText('Paused');
  await created.getByRole('button', { name: 'Delete Stretch break' }).click();
  await page.getByRole('dialog', { name: 'Delete "Stretch break"?' }).getByRole('button', { name: 'Delete reward' }).click();
  await expect(created).toHaveCount(0);

  // Complete one redemption, then refund the rest in one go.
  const queue = page.getByRole('region', { name: 'Redemption queue' });
  const items = queue.locator('[data-redemption]');
  await expect(items).toHaveCount(4);
  await queue.getByRole('button', { name: /^Complete .*Hydrate$/ }).first().click();
  await expect(page.getByText('Completed 1 redemption')).toBeVisible();
  await expect(items).toHaveCount(3);
  await queue.getByText('Select all').click();
  await queue.getByRole('button', { name: 'Refund', exact: true }).click();
  await expect(page.getByText('Refunded 3 redemptions')).toBeVisible();
  await expect(queue.getByText('Nothing waiting')).toBeVisible();
});

test('end the running poll, start a new one and end it', async ({ page }) => {
  await openInteract(page, 'Polls & predictions');
  const poll = page.getByRole('region', { name: 'Poll', exact: true });
  await expect(poll.getByText('Which map next?')).toBeVisible();
  await expect(poll.getByText(/left$/)).toBeVisible();
  await page.screenshot({ path: join(screens, 'interact-polls.png') });

  await poll.getByRole('button', { name: 'End poll now' }).click();
  await expect(poll.getByText('Final result')).toBeVisible();
  await poll.getByRole('button', { name: 'New poll' }).click();

  const form = poll.getByRole('form', { name: 'Start a poll' });
  await form.getByRole('button', { name: 'Start poll' }).click();
  await expect(form.getByText('Type the question.')).toBeVisible();
  await form.getByLabel('Question').fill('Snack break?');
  await form.getByRole('textbox', { name: 'Choice 1' }).fill('Yes');
  await form.getByRole('textbox', { name: 'Choice 2' }).fill('After this round');
  await form.getByLabel('Runs for').selectOption('60');
  await form.getByRole('button', { name: 'Start poll' }).click();
  await expect(page.getByText('Poll started')).toBeVisible();
  await expect(poll.getByText('Snack break?')).toBeVisible();
  await expect(poll.getByText('1:00 left').or(poll.getByText('0:59 left'))).toBeVisible();

  await poll.getByRole('button', { name: 'End poll now' }).click();
  await expect(poll.getByText('Final result')).toBeVisible();

  // Predictions: pay out the locked one, then start a new one, lock it and pick the winner.
  const pred = page.getByRole('region', { name: 'Prediction' });
  await expect(pred.getByText('Clutch this round?')).toBeVisible();
  await pred.getByRole('button', { name: 'Easy clutch won' }).click();
  await expect(pred.getByText('Result')).toBeVisible();
  await pred.getByRole('button', { name: 'New prediction' }).click();
  const pform = pred.getByRole('form', { name: 'Start a prediction' });
  await pform.getByLabel('Question').fill('Win this round?');
  await pform.getByRole('textbox', { name: 'Outcome 1' }).fill('Yes');
  await pform.getByRole('textbox', { name: 'Outcome 2' }).fill('No');
  await pform.getByRole('button', { name: 'Start prediction' }).click();
  await expect(pred.getByText('Live')).toBeVisible();
  await pred.getByRole('button', { name: 'Lock now' }).click();
  await expect(pred.getByText('Locked')).toBeVisible();
  await pred.getByRole('button', { name: 'No won' }).click();
  await expect(pred.getByText('Result')).toBeVisible();
});

test('the poll layer shows in the editor', async ({ page }) => {
  await page.getByRole('button', { name: 'Overlays', exact: true }).click();
  await page.locator('[data-overlay-card]').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Add poll / prediction layer' }).click();
  const layer = page.locator('.cw-stage [data-layer-type="poll"]');
  await expect(layer.locator('.cw-poll-title')).toHaveText('Which map next?');
  await expect(layer.locator('.cw-poll-choice')).toHaveCount(3);
  await expect(layer.locator('.cw-poll-timer')).toHaveText(/left$/);
  await expect(page.getByText('Each choice')).toBeVisible();
  await page.screenshot({ path: join(screens, 'interact-poll-layer.png') });
});
