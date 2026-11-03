import { expect, test, type Page } from '@playwright/test';
import { stubProviders } from '../providers';

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || (m.type() === 'warning' && m.text().includes('[svelte]'))) errors.push(`console: ${m.text()}`);
  });
  await page.setViewportSize({ width: 1800, height: 1000 });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await stubProviders(page);
  await page.goto('/?demo=static');
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Automation' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Automation' })).toBeVisible();
  return errors;
}

test('variable inspector: details, jump to a reader, rename', async ({ page }) => {
  const errors = await open(page);
  const vars = page.getByRole('region', { name: 'Variables' });

  // Filters.
  await vars.getByRole('radio', { name: 'Unused' }).click();
  await expect(vars.getByRole('button', { name: 'obs.scene details' })).not.toContainText('Used');
  await expect(vars.getByRole('button', { name: 'counter.deaths details' })).toHaveCount(0);
  await vars.getByRole('radio', { name: 'Used', exact: true }).click();
  const row = vars.getByRole('button', { name: 'counter.deaths details' });
  await expect(row).toContainText('Used in 2');

  // Details.
  await row.click();
  const details = page.getByRole('dialog', { name: 'counter.deaths' });
  await expect(details).toBeVisible();
  await expect(details.getByText('Number', { exact: true })).toBeVisible();
  const written = details.getByRole('region', { name: 'Written by' });
  const read = details.getByRole('region', { name: 'Read by' });
  await expect(written.getByRole('button')).toHaveText(/Count deaths.*Add to variable · Variable/);
  await expect(read.getByRole('button')).toHaveText(/Count deaths.*Send chat message · Message/);

  // Jump to the reader: the action opens with the step selected in the inspector.
  await read.getByRole('button').click();
  await expect(details).toBeHidden();
  await expect(page.locator('.crumb')).toContainText('Count deaths');
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await expect(inspector.getByRole('textbox', { name: 'Message' })).toHaveValue('Deaths: {{counter.deaths}}');

  // The variable in the field has a card.
  const chip = inspector.getByRole('group', { name: 'Variables in Message' }).getByRole('button', { name: 'counter.deaths' });
  await chip.hover();
  await expect(page.getByRole('tooltip')).toContainText('Used in 2 places');
  await chip.click();
  await expect(details).toBeVisible();

  // Rename, with a preview.
  await details.getByRole('button', { name: 'Rename…' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename counter.deaths' });
  await rename.getByLabel('New name').fill('bad name');
  await expect(rename.getByRole('alert')).toBeVisible();
  await expect(rename.getByRole('button', { name: 'Rename', exact: true })).toBeDisabled();
  await rename.getByLabel('New name').fill('counter.falls');
  const changes = rename.getByRole('list', { name: 'Changes' });
  await expect(changes.getByRole('listitem')).toHaveCount(2);
  await expect(changes).toContainText('Deaths: {{counter.falls}}');
  await rename.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(rename).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'counter.falls' })).toBeVisible();
  await page.getByRole('dialog', { name: 'counter.falls' }).getByRole('button', { name: 'Close' }).last().click();

  // The steps changed and the value moved.
  await expect(inspector.getByRole('textbox', { name: 'Message' })).toHaveValue('Deaths: {{counter.falls}}');
  await expect(vars.getByRole('button', { name: 'counter.falls details' })).toContainText('Used in 2');
  await expect(vars.getByLabel('Value of counter.falls')).toHaveValue('7');
  await page.locator('[data-node]', { hasText: 'counter.falls + 1' }).click();
  await expect(inspector.getByRole('combobox', { name: 'Variable', exact: true })).toHaveValue('counter.falls');

  // Undo from the message.
  await page.getByRole('button', { name: 'Undo' }).last().click();
  await expect(vars.getByLabel('Value of counter.deaths')).toHaveValue('7');
  await expect(page.locator('[data-node]', { hasText: 'counter.deaths + 1' })).toBeVisible();

  // A layer reader opens the overlay editor with the layer picked.
  await vars.getByRole('button', { name: 'session.subs details' }).click();
  const subs = page.getByRole('dialog', { name: 'session.subs' });
  await expect(subs.getByRole('region', { name: 'Written by' })).toContainText('Twitch');
  await subs.getByRole('region', { name: 'Read by' }).getByRole('button', { name: /Sub goal/ }).click();
  await expect(page.getByRole('button', { name: /^Sub goal/, pressed: true })).toBeVisible();

  expect(errors).toEqual([]);
});

test('variable inspector: typos and unread variables', async ({ page }) => {
  const errors = await open(page);
  const vars = page.getByRole('region', { name: 'Variables' });

  // Point the chat message at a misspelled name.
  await page.getByRole('navigation', { name: 'Actions' }).getByRole('button', { name: /^Count deaths/ }).click();
  await page.locator('[data-node]', { hasText: 'Deaths: {{counter.deaths}}' }).click();
  await page.keyboard.press('Enter');
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await inspector.getByRole('textbox', { name: 'Message' }).fill('Deaths: {{ counter.death | default:"0" }}');
  await vars.getByRole('radio', { name: /Problems/ }).click();
  await vars.getByRole('button', { name: 'counter.death details' }).click();
  const details = page.getByRole('dialog', { name: 'counter.death' });
  await expect(details).toContainText('Did you mean counter.deaths?');
  await details.getByRole('button', { name: 'Change to counter.deaths…' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename counter.death' });
  await expect(rename.getByLabel('New name')).toHaveValue('counter.deaths');
  await rename.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'counter.deaths' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(inspector.getByRole('textbox', { name: 'Message' })).toHaveValue('Deaths: {{ counter.deaths | default:"0" }}');

  // A saved variable nothing reads.
  await vars.getByRole('button', { name: 'Add' }).click();
  await vars.getByLabel('New variable name').fill('hugs.total');
  await vars.getByLabel('New variable value').fill('3');
  await vars.getByRole('button', { name: 'Add', exact: true }).last().click();
  await vars.getByRole('button', { name: 'hugs.total details' }).click();
  const unread = page.getByRole('dialog', { name: 'hugs.total' });
  await expect(unread).toContainText('nothing in the project reads it');
  await unread.getByRole('button', { name: 'Delete variable' }).click();
  await expect(unread).toBeHidden();
  await expect(vars.getByRole('button', { name: 'hugs.total details' })).toHaveCount(0);

  expect(errors).toEqual([]);
});
