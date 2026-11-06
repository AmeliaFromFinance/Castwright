import { expect, type Locator, type Page } from '@playwright/test';
import { stubProviders, type ProviderData } from '../providers';

/** Open the app on the demo backend and fail the test on any page error. */
export async function openApp(page: Page, query = 'demo=static', providers: ProviderData = {}): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await stubProviders(page, providers);
  await page.goto(`/?${query}`);
  await expect(page.locator('.splash')).toHaveCount(0);
  return errors;
}

export async function goTo(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name }).click();
}

/** Pick a file with an asset picker: open its window, then click the file. */
export async function chooseAsset(page: Page, picker: Locator, name: string) {
  await picker.click();
  const dlg = page.getByRole('dialog', { name: /^Choose / });
  await dlg.getByRole('button', { name: name === 'None' ? 'None' : new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).first().click();
  await expect(dlg).toBeHidden();
}
