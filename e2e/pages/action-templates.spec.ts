import { expect, test } from '@playwright/test';
import { stubProviders } from '../providers';

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || (m.type() === 'warning' && m.text().includes('[svelte]'))) errors.push(`console: ${m.text()}`);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await stubProviders(page);
  await page.goto('/?demo=static');
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Automation' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Automation' })).toBeVisible();
});

test.afterEach(() => {
  expect(errors, 'no page or console errors').toEqual([]);
});

test('an action from a template, with its sound linked and turned on', async ({ page }) => {
  await page.getByRole('button', { name: 'New action' }).click();
  const picker = page.getByRole('dialog', { name: 'New action' });
  await expect(picker.getByRole('button', { name: /^Shoutout on raid/ })).toBeVisible();
  await expect(picker.locator('.mini svg').first()).toBeVisible();
  await picker.getByRole('button', { name: /^Redemption sound/ }).click();

  const dlg = page.getByRole('dialog', { name: 'Add from template' });
  const turnOn = dlg.getByRole('switch', { name: 'Turn on now' });
  await expect(turnOn).toBeDisabled();
  await expect(dlg.getByText('1 unlinked')).toBeVisible();
  await dlg.getByRole('combobox', { name: 'Link file “redeem.mp3”' }).selectOption('fanfare.ogg');
  await expect(turnOn).toBeEnabled();
  await turnOn.click();
  await dlg.getByRole('button', { name: 'Add 1 action' }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByText(`Added "Redemption sound". It's on.`)).toBeVisible();

  await expect(page.getByLabel('Action name')).toHaveValue('Redemption sound');
  await expect(page.getByRole('switch', { name: 'Enabled' })).toBeChecked();
  const flow = page.getByRole('region', { name: 'Flow of Redemption sound' });
  await expect(flow.getByText('fanfare.ogg at 80%')).toBeVisible();
  await expect(page.getByText('Not connected')).toHaveCount(0);
});

test('templates start off unless turned on, and taken names get a number', async ({ page }) => {
  await page.getByRole('button', { name: 'New action' }).click();
  await page.getByRole('dialog', { name: 'New action' }).getByRole('button', { name: /^Hydrate reminder/ }).click();
  const dlg = page.getByRole('dialog', { name: 'Add from template' });
  await expect(dlg.getByRole('switch', { name: 'Turn on now' })).not.toBeChecked();
  await expect(dlg.getByText('Name taken')).toBeVisible();
  await dlg.getByRole('button', { name: 'Add 1 action' }).click();
  await expect(page.getByLabel('Action name')).toHaveValue('Hydrate reminder (2)');
  await expect(page.getByRole('switch', { name: 'Enabled' })).not.toBeChecked();
});
