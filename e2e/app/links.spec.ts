import { expect, test, type Page } from '@playwright/test';
import { goTo, openApp } from './helpers';

const OUTSIDE = /^https:\/\/(castwright\.sinist3r\.lol|github\.com|example\.com)\//;

/** Clicks and returns the address of the page it opened. */
async function opens(page: Page, click: () => Promise<void>): Promise<string> {
  const popup = page.waitForEvent('popup');
  await click();
  const p = await popup;
  const url = p.url();
  await p.close();
  return url;
}

test('external links open a new page', async ({ page, context }) => {
  await context.route(OUTSIDE, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>ok</title>' }));
  const errors = await openApp(page);

  await goTo(page, 'Settings');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'About' }).click();
  expect(await opens(page, () => page.getByRole('button', { name: 'Guide' }).click())).toBe('https://castwright.sinist3r.lol/');
  expect(await opens(page, () => page.getByRole('button', { name: 'Source code' }).click())).toMatch(/^https:\/\/github\.com\/AmeliaFromFinance\/castwright$/i);
  expect(await opens(page, () => page.getByRole('button', { name: 'Report a problem' }).click())).toMatch(/\/issues$/);

  await page.getByRole('button', { name: "What's new" }).click();
  const news = page.getByRole('dialog', { name: /What's new/ });
  expect(await opens(page, () => news.getByRole('button', { name: 'Full changelog' }).click())).toBe('https://castwright.sinist3r.lol/changelog/');
  await news.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Save bug report…' }).first().click();
  const report = page.getByRole('dialog', { name: /bug report/i });
  expect(await opens(page, () => report.getByRole('button', { name: 'Open GitHub issue' }).click())).toMatch(/\/issues\/new\?title=/);
  await page.keyboard.press('Escape');

  // Plain links anywhere in the app go the same way.
  await page.evaluate(() => {
    const a = document.createElement('a');
    a.href = 'https://example.com/later';
    a.target = '_blank';
    a.textContent = 'a link added later';
    document.querySelector('main')?.append(a);
  });
  expect(await opens(page, () => page.getByRole('link', { name: 'a link added later' }).click())).toBe('https://example.com/later');
  expect(errors).toEqual([]);
});
