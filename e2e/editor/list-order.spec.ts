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

const canvas = (page: Page) => page.locator('.cw-stage').first();

/** Message ids from the top of the box down, and the gaps to the top and bottom edges. */
async function layout(page: Page) {
  return canvas(page)
    .locator('.cw-type-chat .cw-chat')
    .evaluate((list) => {
      const box = list.getBoundingClientRect();
      const lines = [...list.querySelectorAll<HTMLElement>('.cw-chat-line')];
      const visible = lines.filter((l) => {
        const r = l.getBoundingClientRect();
        return r.bottom > box.top && r.top < box.bottom;
      });
      const first = visible[0]!.getBoundingClientRect();
      const last = visible[visible.length - 1]!.getBoundingClientRect();
      return {
        ids: lines.map((l) => l.dataset.msgId),
        order: list.dataset.order,
        stack: list.dataset.stack,
        topGap: Math.round(first.top - box.top),
        bottomGap: Math.round(box.bottom - last.bottom)
      };
    });
}

test('chat shows new messages at the bottom or the top', async ({ page }) => {
  await page.getByRole('button', { name: 'Overlays', exact: true }).click();
  await page.locator('[data-overlay-card]').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('[data-layer-row]').filter({ hasText: 'Chat' }).locator('.pick').click();
  // A short list, so the stack edge shows.
  await page.getByLabel('Maximum messages').fill('2');
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await page.getByRole('button', { name: 'Chat message', exact: true }).click();
  await page.keyboard.press('Escape');

  const before = await layout(page);
  expect([before.order, before.stack]).toEqual(['bottom', 'bottom']);
  expect(before.bottomGap).toBeLessThan(before.topGap);
  const newest = before.ids[before.ids.length - 1];

  await page.getByRole('radiogroup', { name: 'New messages' }).getByRole('radio', { name: 'At the top' }).click();
  const top = await layout(page);
  expect([top.order, top.stack]).toEqual(['top', 'top']);
  expect(top.ids[0]).toBe(newest);
  expect(top.ids).toEqual(before.ids.slice().reverse());
  expect(top.topGap).toBeLessThan(top.bottomGap);

  // Newest first, but sitting against the bottom edge.
  await page.getByRole('radiogroup', { name: 'Stack from' }).getByRole('radio', { name: 'Bottom' }).click();
  const mixed = await layout(page);
  expect([mixed.order, mixed.stack]).toEqual(['top', 'bottom']);
  expect(mixed.ids[0]).toBe(newest);
  expect(mixed.bottomGap).toBeLessThan(mixed.topGap);

  await page.getByRole('radiogroup', { name: 'New messages' }).getByRole('radio', { name: 'At the bottom' }).click();
  expect((await layout(page)).ids).toEqual(before.ids);
});
