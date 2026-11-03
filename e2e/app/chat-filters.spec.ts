import { expect, test } from '@playwright/test';
import { goTo, openApp } from './helpers';

test('chat filters hide and highlight in the panel', async ({ page }) => {
  const errors = await openApp(page);
  await goTo(page, 'Activity');
  await page.getByRole('radio', { name: /Chat/ }).click();
  const chat = page.getByRole('listbox', { name: 'Chat messages' });
  const line = (name: string) => chat.getByRole('option', { name: new RegExp(`^${name}:`) });

  // Bots and commands are hidden by default; first-time chatters and mentions stand out.
  await expect(line('tinyowl')).toBeVisible();
  await expect(line('Nightbot')).toHaveCount(0);
  await expect(line('glitchgoose')).toHaveCount(0);
  await expect(line('tinyowl')).toHaveAttribute('data-highlight', 'first');
  await expect(line('tinyowl')).toContainText('first message');
  await expect(line('river_dev')).toHaveAttribute('data-highlight', 'mention');
  await expect(line('wren_plays')).toHaveAttribute('data-highlight', 'redeemed');

  // Hidden messages can show as a short line, and open up.
  await page.getByRole('button', { name: 'Chat display options' }).click();
  await page.getByRole('switch', { name: 'Show hidden as a line' }).click();
  const run = chat.getByRole('button', { name: /1 hidden · command/ });
  await expect(run).toBeVisible();
  await expect(chat.getByRole('button', { name: /1 hidden · bot/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await run.click();
  await expect(line('glitchgoose')).toHaveAttribute('data-hidden', 'command');

  // Turning a rule off in the panel changes the shared rules.
  await page.getByRole('button', { name: 'Chat display options' }).click();
  await page.getByRole('switch', { name: 'Show hidden as a line' }).click();
  await page.getByRole('switch', { name: 'Hide !commands' }).click();
  await expect(line('glitchgoose')).toBeVisible();
  await expect(line('glitchgoose')).not.toHaveAttribute('data-hidden');
  await page.getByRole('switch', { name: 'Highlight mentions' }).click();
  await expect(line('river_dev')).not.toHaveAttribute('data-highlight');

  // Words are set in Settings.
  await page.getByRole('button', { name: 'All filters in Settings…' }).click();
  const words = page.getByRole('textbox', { name: 'Words', exact: true });
  await words.fill('/(a+)+/');
  await words.blur();
  await expect(page.getByRole('alert').filter({ hasText: 'Repeats inside repeats' })).toBeVisible();
  await words.fill('font');
  await words.blur();
  await expect(page.getByRole('alert').filter({ hasText: 'Repeats inside repeats' })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Keywords' }).fill('raid');
  await page.getByRole('textbox', { name: 'Keywords' }).blur();
  await goTo(page, 'Activity');
  await page.getByRole('radio', { name: /Chat/ }).click();
  await expect(line('river_dev')).toHaveCount(0);
  await expect(chat.getByRole('option', { name: /hello from the raid/ }).first()).toHaveAttribute('data-highlight', 'keyword');

  // Mod tools still work on what's shown.
  const owl = line('tinyowl');
  await owl.hover();
  await owl.getByRole('button', { name: 'Message actions' }).click();
  await expect(page.getByRole('menu', { name: 'Message actions for tinyowl' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Switching filters off shows everything.
  await page.getByRole('button', { name: 'Chat display options' }).click();
  await page.getByRole('switch', { name: 'Use filters' }).click();
  await expect(line('Nightbot')).toBeVisible();
  await expect(line('tinyowl')).not.toHaveAttribute('data-highlight');
  expect(errors).toEqual([]);
});
