import { expect, test, type Page } from '@playwright/test';
import { goTo, openApp } from './helpers';

const status = (page: Page) => page.getByRole('contentinfo', { name: 'Status' });

/** Opens the demo with everything in the status bar, once the update is halfway. */
async function busy(page: Page, width: number): Promise<string[]> {
  await page.setViewportSize({ width, height: 800 });
  const errors = await openApp(page, 'demo=static&busy');
  await expect(status(page).locator('[data-key="update:full"] button')).toHaveAttribute('aria-label', 'Downloading update, 45%');
  await expect(status(page).getByRole('button', { name: /^Health: .*warning/ })).toBeVisible();
  // Let the bar settle after the last size change.
  await page.waitForTimeout(300);
  return errors;
}

async function overflow(page: Page) {
  return status(page).evaluate((footer) => {
    const bar = footer.querySelector<HTMLElement>('[role="toolbar"]')!;
    const box = bar.getBoundingClientRect();
    const items = [...bar.querySelectorAll<HTMLElement>('[data-sb-item] > :not(.pop-root), [data-sb-item] > .pop-root > button, [data-sb-more] .pop-root > button')].map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.closest<HTMLElement>('[data-sb-item]')?.dataset.sbItem ?? 'more', clipped: el.scrollWidth > el.clientWidth, outside: r.left < box.left - 1 || r.right > box.right + 1 };
    });
    const groups = [...bar.querySelectorAll<HTMLElement>('[role="group"]')].map((g) => g.getBoundingClientRect());
    return {
      footer: footer.scrollWidth > footer.clientWidth,
      bar: bar.scrollWidth > bar.clientWidth,
      overlap: groups.length === 2 && groups[0]!.right > groups[1]!.left,
      bad: items.filter((i) => i.clipped || i.outside).map((i) => i.id)
    };
  });
}

for (const width of [1024, 1440, 2560]) {
  test(`nothing is clipped at ${width} px`, async ({ page }) => {
    const errors = await busy(page, width);
    expect(await overflow(page)).toEqual({ footer: false, bar: false, overlap: false, bad: [] });
    expect(errors).toEqual([]);
  });
}

test('critical items stay visible at 1024 px and the rest folds into More', async ({ page }) => {
  const errors = await busy(page, 1024);
  const bar = status(page);
  await expect(bar.getByRole('button', { name: 'OBS connected' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Twitch · Castwright' })).toBeVisible();
  await expect(bar.locator('[data-sb-item="live"]')).toHaveText(/^Live \d/);
  await expect(bar.getByRole('button', { name: /^Ad in 0:\d\d$/ })).toBeVisible();
  await expect(bar.getByRole('button', { name: /^Health:/ })).toBeVisible();

  const more = bar.getByRole('button', { name: /^\d+ more$/ });
  await expect(more).toBeVisible();
  const n = Number((await more.textContent())!.trim().split(' ')[0]);
  expect(n).toBeGreaterThan(0);
  await more.click();
  const pop = page.getByRole('dialog', { name: 'More status items' });
  await expect(pop.getByRole('listitem')).toHaveCount(n);
  // The version gives way first.
  await expect(pop.getByText(/^v\d+\.\d+\.\d+$/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  await expect(more).toBeFocused();
  expect(errors).toEqual([]);
});

test('items in More keep their click actions', async ({ page }) => {
  const errors = await openApp(page, 'demo=static');
  await page.setViewportSize({ width: 1024, height: 800 });
  // Zoom in until the overlay server folds.
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+Equal');
  const more = status(page).getByRole('button', { name: /^\d+ more$/ });
  await more.click();
  const pop = page.getByRole('dialog', { name: 'More status items' });
  await pop.getByRole('button', { name: /^Overlay server/ }).click();
  await expect(pop).toHaveCount(0);
  await expect(page.locator('#server')).toBeVisible();
  expect(errors).toEqual([]);
});

test('arrow keys move between status bar items', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 800 });
  const errors = await openApp(page);
  const obs = status(page).getByRole('button', { name: 'OBS connected' });
  const twitch = status(page).getByRole('button', { name: 'Twitch · Castwright' });
  await expect(obs).toHaveAttribute('tabindex', '0');
  await expect(twitch).toHaveAttribute('tabindex', '-1');
  await obs.focus();
  await page.keyboard.press('ArrowRight');
  await expect(twitch).toBeFocused();
  await expect(twitch).toHaveAttribute('tabindex', '0');
  await page.keyboard.press('ArrowLeft');
  await expect(obs).toBeFocused();
  await page.keyboard.press('End');
  await expect(status(page).getByRole('button').last()).toBeFocused();
  expect(errors).toEqual([]);
});

test('Settings can hide CPU from the status bar', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 800 });
  const errors = await openApp(page);
  const cpu = status(page).locator('[data-sb-item="cpu"]');
  await expect(cpu).toBeVisible();
  await goTo(page, 'Settings');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Appearance' }).click();
  const group = page.getByRole('group', { name: 'Status bar items' });
  await group.getByRole('checkbox', { name: 'CPU' }).uncheck();
  await expect(cpu).toHaveCount(0);
  await expect(status(page).locator('[data-sb-item="fps"]')).toBeVisible();

  await page.reload();
  await expect(page.locator('.splash')).toHaveCount(0);
  await expect(status(page).locator('[data-sb-item="fps"]')).toBeVisible();
  await expect(status(page).locator('[data-sb-item="cpu"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
