import { expect, test } from '@playwright/test';
import { goTo, openApp } from '../app/helpers';

test('a Now playing layer shows the demo song in each layout', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: 'Overlays', exact: true }).click();
  await page.locator('[data-overlay-card]').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Add now playing layer' }).click();

  const np = page.locator('.cw-stage [data-layer-type="now_playing"] .cw-np');
  await expect(np).toHaveClass(/cw-np-card/);
  await expect(np).toHaveClass(/cw-np-playing/);
  await expect(np.locator('.cw-np-title')).toHaveText('Midnight Drive');
  await expect(np.locator('.cw-np-artist')).toHaveText('Neon Harbor');
  await expect(np.locator('.cw-np-art img')).toHaveAttribute('src', /^data:image\/svg\+xml,/);
  await expect(np.locator('.cw-np-duration')).toHaveText('3:33');
  await expect(np.locator('.cw-np-elapsed')).toHaveText(/^1:0\d$/);
  const width = await np.locator('.cw-np-fill').evaluate((el) => parseFloat((el as HTMLElement).style.width));
  expect(width).toBeGreaterThan(25);
  expect(width).toBeLessThan(40);

  await page.getByRole('switch', { name: 'Album' }).click();
  await expect(np.locator('.cw-np-album')).toHaveText('Night Shift');
  await page.getByRole('switch', { name: 'Times' }).click();
  await expect(np.locator('.cw-np-times')).toHaveCount(0);

  await page.getByRole('radio', { name: 'Vinyl' }).click();
  await expect(np).toHaveClass(/cw-np-vinyl/);
  expect(await np.locator('.cw-np-art').evaluate((el) => getComputedStyle(el).borderRadius)).toBe('50%');
  await page.getByRole('radio', { name: 'Compact' }).click();
  await expect(np.locator('.cw-np-title')).toHaveText('Midnight Drive · Neon Harbor');

  // Box presets style the song card.
  const frame = page.locator('.cw-stage [data-layer-type="now_playing"] style[data-cw-frame]');
  const before = await frame.textContent();
  expect(before).toContain('.cw-np-item');
  await page.getByRole('button', { name: /^Cards/ }).click();
  await page.getByRole('button', { name: /^Neon style/ }).first().click();
  await expect.poll(() => frame.textContent()).not.toBe(before);

  // With music off, the editor keeps a sample song on the canvas.
  await goTo(page, 'Settings');
  const off = page.locator('#music').getByRole('radio', { name: 'Off' });
  await off.click();
  await expect(off).toBeChecked();
  await goTo(page, 'Overlays');
  await expect(page.locator('.cw-stage .cw-np-title')).toHaveText('Song title · Artist name');
  expect(errors).toEqual([]);
});

test('Music settings walk through each source', async ({ page }) => {
  const errors = await openApp(page);
  await goTo(page, 'Settings');
  await page.getByRole('button', { name: 'Music', exact: true }).click();
  const music = page.locator('#music');
  await expect(music.getByText('Midnight Drive')).toBeVisible();
  await expect(music.getByText('http://127.0.0.1:7470/spotify/callback')).toBeVisible();
  await expect(music.getByText('Signed in as Demo listener')).toBeVisible();

  await music.getByRole('radio', { name: 'This computer' }).click();
  await expect(music.getByText(/Reads the song from whatever shows/)).toBeVisible();
  await music.getByRole('radio', { name: 'Text file' }).click();
  await expect(music.getByRole('textbox', { name: 'Text format' })).toHaveValue('{artist} - {title}');
  await music.getByRole('radio', { name: 'Off' }).click();
  await expect(music.getByText('Midnight Drive')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('long song names can scroll', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: 'Overlays', exact: true }).click();
  await page.locator('[data-overlay-card]').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Add now playing layer' }).click();
  await page.getByRole('combobox', { name: 'Long text' }).selectOption('scroll');
  await expect(page.getByRole('spinbutton', { name: 'Scroll speed' })).toHaveValue('60');

  const title = page.locator('.cw-stage [data-layer-type="now_playing"] .cw-np-title');
  await expect(title).toHaveClass(/cw-marquee/);
  await expect(title).not.toHaveClass(/cw-marquee-moving/);
  await expect(title.locator('.cw-marquee-item')).toHaveCount(1);

  await page.getByRole('spinbutton', { name: 'Width', exact: true }).fill('240');
  await expect(title).toHaveClass(/cw-marquee-moving/);
  await expect(title.locator('.cw-marquee-item')).toHaveCount(2);
  await expect(title.locator('.cw-marquee-item').nth(1)).toHaveAttribute('aria-hidden', 'true');
  const x = () => title.locator('.cw-marquee-track').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
  await expect.poll(x, { timeout: 6000 }).toBeLessThan(-5);

  await page.getByRole('combobox', { name: 'Long text' }).selectOption('cut');
  await expect(title).toHaveClass(/cw-cut/);
  expect(await title.evaluate((el) => getComputedStyle(el).textOverflow)).toBe('ellipsis');
  expect(errors).toEqual([]);
});
