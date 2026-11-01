import { expect, type Page } from '@playwright/test';

/** Open the app on the demo backend and fail the test on any page error. */
export async function openApp(page: Page, query = 'demo=static'): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`/?${query}`);
  await expect(page.locator('.splash')).toHaveCount(0);
  return errors;
}

export async function goTo(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name }).click();
}
