import { expect, test, type Page } from '@playwright/test';
import { openApp } from '../app/helpers';

async function addLayer(page: Page) {
  await page.getByRole('button', { name: 'Overlays', exact: true }).click();
  await page.locator('[data-overlay-card]').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Add hype train layer' }).click();
  return page.locator('.cw-stage [data-layer-type="hype_train"] .cw-hype');
}

test('a Hype train layer shows a sample train in the editor', async ({ page }) => {
  const errors = await openApp(page);
  const hype = await addLayer(page);

  await expect(hype).toHaveClass(/cw-hype-card/);
  await expect(hype).toHaveClass(/cw-hype-running/);
  await expect(hype.locator('.cw-hype-title')).toHaveText('Hype train');
  await expect(hype.locator('.cw-hype-level')).toHaveText('Level 3');
  await expect(hype.locator('.cw-hype-timer')).toHaveText(/^[0-4]:[0-5]\d$/);
  await expect(hype.locator('.cw-hype-total')).toHaveText('Total 4,820');
  await expect(hype.locator('.cw-hype-top-item')).toHaveText(['Top bits: pixelbyte · 2,500', 'Top sub: nova_kat']);
  const width = await hype.locator('.cw-hype-fill').evaluate((el) => parseFloat((el as HTMLElement).style.width));
  expect(width).toBeGreaterThanOrEqual(32);
  expect(width).toBeLessThanOrEqual(80);
  await expect(hype.locator('.cw-hype-pct')).toHaveText(`${Math.round(width)}%`);

  // A level up shows "Level up!" for a moment.
  await page.getByRole('button', { name: 'Try it' }).click();
  await expect(hype.locator('.cw-hype-levelup')).toHaveText('Level up!');
  await expect(hype.locator('.cw-hype-level')).toHaveText('Level 4');
  await expect(hype).toHaveClass(/cw-hype-levelling/);
  await expect(hype.locator('.cw-hype-levelup')).toHaveCount(0, { timeout: 5000 });

  await page.getByRole('switch', { name: 'Top contributors' }).click();
  await expect(hype.locator('.cw-hype-top-item')).toHaveCount(0);
  await page.getByRole('switch', { name: 'Time left' }).click();
  await expect(hype.locator('.cw-hype-timer')).toHaveCount(0);

  await page.getByRole('radio', { name: 'Bar' }).click();
  await expect(hype).toHaveClass(/cw-hype-bar/);
  await expect(hype.locator('.cw-hype-level')).toHaveText('Lv 4');
  await expect(hype.locator('.cw-hype-head .cw-hype-track')).toHaveCount(1);

  // After the end: the end text, for as long as the layer says.
  await page.getByRole('radio', { name: 'Ended' }).click();
  await expect(hype).toHaveClass(/cw-hype-ended/);
  await expect(hype.locator('.cw-hype-end')).toHaveText('Hype train reached level 4!');
  await page.getByRole('textbox', { name: 'End text' }).fill('Choo choo! Level {{level}}');
  await expect(hype.locator('.cw-hype-end')).toHaveText('Choo choo! Level 4');
  await page.getByRole('radio', { name: 'Running' }).click();

  // Box presets style the train card.
  const frame = page.locator('.cw-stage [data-layer-type="hype_train"] style[data-cw-frame]');
  const before = await frame.textContent();
  expect(before).toContain('.cw-hype-item');
  await page.getByRole('button', { name: /^Cards/ }).click();
  await page.getByRole('button', { name: /^Neon style/ }).first().click();
  await expect.poll(() => frame.textContent()).not.toBe(before);
  expect(errors).toEqual([]);
});

test('a running train in the demo replaces the sample', async ({ page }) => {
  const errors = await openApp(page, 'demo=static&hype');
  const hype = await addLayer(page);
  await expect(hype.locator('.cw-hype-level')).toHaveText('Level 3');
  await expect(hype.locator('.cw-hype-pct')).toHaveText('64%');
  await expect(hype.locator('.cw-hype-total')).toHaveText('Total 4,820');
  await expect(hype).toHaveAttribute('data-type', 'regular');
  expect(errors).toEqual([]);
});
