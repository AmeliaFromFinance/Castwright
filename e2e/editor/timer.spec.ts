import { expect, test, type Page } from '@playwright/test';
import { stubProviders } from '../providers';

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || (m.type() === 'warning' && m.text().includes('[svelte]'))) errors.push(`console: ${m.text()}`);
  });
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await stubProviders(page);
  await page.goto('/?demo=static', { timeout: 90_000 });
});

test.afterEach(() => {
  expect(errors, 'no page or console errors').toEqual([]);
});

const timer = (page: Page) => page.locator('.cw-stage').first().locator('.cw-type-timer .cw-timer');

async function rightClickTimer(page: Page) {
  const box = (await timer(page).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await expect(page.getByRole('menu', { name: 'Layer' })).toBeVisible();
}

const menuItem = (page: Page, name: string) => page.getByRole('menu', { name: 'Layer' }).getByRole('menuitem', { name });

test('the timer context menu starts, pauses, resumes and resets a countdown', async ({ page }) => {
  await page.getByRole('button', { name: 'Overlays', exact: true }).click();
  await page.locator('[data-overlay-card]').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Add timer layer' }).click();
  await page.getByLabel('Countdown length in seconds').fill('300');
  // Not started yet: it counts from when the page loaded, as before.
  await expect(timer(page)).toHaveText(/^0[45]:\d\d$/);
  await expect(timer(page)).toHaveAttribute('data-state', 'idle');

  await rightClickTimer(page);
  await expect(menuItem(page, 'Pause timer')).toHaveCount(0);
  await menuItem(page, 'Start timer').click();
  await expect(timer(page)).toHaveAttribute('data-state', 'running');
  await expect(timer(page)).toHaveText('04:59', { timeout: 4000 });
  await expect(page.getByRole('group', { name: 'Timer controls' }).getByRole('button', { name: 'Restart' })).toBeVisible();

  await rightClickTimer(page);
  await menuItem(page, 'Pause timer').click();
  await expect(timer(page)).toHaveAttribute('data-state', 'paused');
  const paused = await timer(page).textContent();
  await page.waitForTimeout(1600);
  await expect(timer(page)).toHaveText(paused!);
  await expect(page.getByRole('group', { name: 'Timer controls' }).getByRole('button', { name: 'Resume' })).toBeVisible();

  await rightClickTimer(page);
  await menuItem(page, 'Resume timer').click();
  await expect(timer(page)).toHaveAttribute('data-state', 'running');
  await expect(timer(page)).not.toHaveText(paused!, { timeout: 4000 });

  // The same menu is on the layer list.
  await page.locator('[data-layer-row]').filter({ hasText: 'Timer' }).click({ button: 'right' });
  await menuItem(page, 'Reset timer').click();
  await expect(timer(page)).toHaveText('05:00');
  await expect(timer(page)).toHaveAttribute('data-state', 'idle');
  await expect(page.getByRole('group', { name: 'Timer controls' }).getByRole('button', { name: 'Reset' })).toBeDisabled();
});
