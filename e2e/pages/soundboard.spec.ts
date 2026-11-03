import { expect, test, type Page } from '@playwright/test';
import { goTo, openApp } from '../app/helpers';

async function openBoard(page: Page) {
  await goTo(page, 'Interact');
  await page.getByRole('radio', { name: 'Soundboard', exact: true }).click();
  return page.getByRole('region', { name: 'Soundboard' });
}

const cells = (page: Page) => page.getByRole('list', { name: 'Sounds' }).locator('li');

test('add a sound, play it, stop it and wait out its cooldown', async ({ page }) => {
  const errors = await openApp(page);
  const board = await openBoard(page);
  await expect(board.getByRole('button', { name: 'Play Airhorn' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Memes/ })).toBeVisible();

  await board.getByRole('button', { name: 'Add sound' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add sound' });
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Rimshot');
  await dialog.getByLabel('Emoji').fill('🥁');
  await dialog.getByRole('combobox', { name: 'Sound file' }).selectOption({ label: 'ding.wav' });
  await dialog.getByLabel('Cooldown (s)').fill('3');
  await dialog.getByRole('radio', { name: 'Only me' }).click();
  await expect(dialog.getByText('Only you hear it')).toBeVisible();
  await dialog.getByRole('button', { name: 'Add sound' }).click();
  await expect(dialog).toBeHidden();

  const play = board.getByRole('button', { name: 'Play Rimshot' });
  await expect(play).toBeVisible();
  await expect(cells(page).last()).toHaveAttribute('data-sound', 'Rimshot');
  await play.click();
  const stop = board.getByRole('button', { name: 'Stop Rimshot' });
  await expect(stop).toHaveAttribute('aria-pressed', 'true');
  await expect(stop.getByText('Playing')).toBeVisible();
  await expect(board.getByRole('button', { name: 'Stop all' })).toBeEnabled();

  // Click again to stop; the cooldown shows on the button.
  await stop.click();
  await expect(play).toHaveAttribute('aria-pressed', 'false');
  await expect(play.getByLabel(/Cooldown \d seconds/)).toBeVisible();
  await play.click();
  await expect(page.getByText(/On cooldown for \d more seconds?\./)).toBeVisible();
  await expect(play.getByLabel(/Cooldown/)).toHaveCount(0, { timeout: 6000 });
  await play.click();
  await expect(board.getByRole('button', { name: 'Stop Rimshot' })).toBeVisible();

  // Stop all stops everything.
  await board.getByRole('button', { name: 'Play Drum roll' }).click();
  await expect(board.getByRole('button', { name: 'Stop Drum roll' })).toBeVisible();
  await board.getByRole('button', { name: 'Stop all' }).click();
  await expect(board.getByRole('button', { name: /^Stop (Rimshot|Drum roll)$/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the soundboard mute is separate from the alert mute', async ({ page }) => {
  const errors = await openApp(page);
  const board = await openBoard(page);
  await board.getByRole('button', { name: 'Mute soundboard' }).click();
  await expect(board.getByRole('button', { name: 'Soundboard muted' })).toHaveAttribute('aria-pressed', 'true');
  await expect(board.getByText(/The soundboard is muted, so nothing plays/)).toBeVisible();
  await board.getByRole('button', { name: 'Play Applause' }).click();
  await expect(page.getByText('The soundboard is muted. Unmute it in the soundboard header.')).toBeVisible();
  await expect(board.getByRole('button', { name: 'Stop Applause' })).toHaveCount(0);
  // Alerts aren't muted by it.
  await expect(page.locator('footer.status')).not.toContainText('muted');
  await board.getByRole('button', { name: 'Soundboard muted' }).click();
  await board.getByRole('button', { name: 'Play Applause' }).click();
  await expect(board.getByRole('button', { name: 'Stop Applause' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('pages, search and drag to reorder', async ({ page }) => {
  const errors = await openApp(page);
  const board = await openBoard(page);
  const names = () => cells(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-sound')));
  expect(await names()).toEqual(['Airhorn', 'Drum roll', 'Applause', 'Ding']);

  await page.getByRole('tab', { name: /Memes/ }).click();
  expect(await names()).toEqual(['Sad trombone', 'Laser']);
  await page.getByRole('tab', { name: /Main/ }).click();

  // Search looks at every page, other names included.
  await board.getByRole('searchbox', { name: 'Search sounds' }).fill('womp');
  expect(await names()).toEqual(['Sad trombone']);
  await expect(page.getByRole('tablist', { name: 'Sound pages' })).toHaveCount(0);
  await board.getByRole('searchbox', { name: 'Search sounds' }).fill('kazoo');
  await expect(board.getByText('No sounds match "kazoo".')).toBeVisible();
  await board.getByRole('searchbox', { name: 'Search sounds' }).fill('');

  await cells(page).nth(3).dragTo(cells(page).first());
  await expect.poll(names).toEqual(['Ding', 'Airhorn', 'Drum roll', 'Applause']);
  // Alt + arrow moves the focused button too.
  await board.getByRole('button', { name: 'Play Ding' }).focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect.poll(names).toEqual(['Airhorn', 'Ding', 'Drum roll', 'Applause']);
  expect(errors).toEqual([]);
});

test('board settings, hotkeys and the automation step', async ({ page }) => {
  const errors = await openApp(page);
  const board = await openBoard(page);
  await board.getByRole('button', { name: 'Soundboard settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Soundboard settings' });
  await settings.getByLabel('Between any two sounds (s)').fill('20');
  await settings.getByRole('textbox', { name: 'New page name' }).fill('Music');
  await settings.getByRole('button', { name: 'Add page' }).click();
  await settings.getByRole('switch', { name: 'Let chat play sounds' }).click();
  await expect(settings.getByText('!sound airhorn')).toBeVisible();
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('tab', { name: /Music/ })).toBeVisible();

  // The global cooldown holds back every sound.
  await board.getByRole('button', { name: 'Play Ding' }).click();
  await expect(board.getByRole('button', { name: 'Stop Ding' })).toBeVisible();
  await expect(board.getByRole('button', { name: 'Play Applause' }).getByLabel(/Cooldown \d+ seconds/)).toBeVisible();

  // Stream Deck links and a hotkey from the sound's editor.
  await board.locator('li[data-sound="Airhorn"]').hover();
  await board.getByRole('button', { name: 'Edit Airhorn' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit sound' });
  await expect(dialog.getByText(/POST http:\/\/127\.0\.0\.1:7470\/api\/sounds\/snd-airhorn\/play\?token=/)).toBeVisible();
  await dialog.getByRole('button', { name: /Hotkey for Airhorn/ }).click();
  await page.keyboard.press('Control+Alt+KeyH');
  await expect(dialog.getByRole('button', { name: /^Hotkey for Airhorn:/ })).toHaveAccessibleName(/Ctrl\+Alt\+H/);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(board.locator('li[data-sound="Airhorn"] .keys')).toHaveText('Ctrl + Alt + H');

  await goTo(page, 'Settings');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Hotkeys' }).click();
  const hotkeys = page.locator('#hotkeys');
  await expect(hotkeys.getByRole('combobox', { name: 'Sound to play' })).toHaveValue('snd-airhorn');
  await expect(hotkeys.getByRole('button', { name: /^Hotkey for Play "Airhorn": Ctrl\+Alt\+H/ })).toBeVisible();
  await expect(hotkeys.getByRole('button', { name: 'Add sound hotkey' })).toBeEnabled();

  // An action step plays a button, with its cooldown.
  await goTo(page, 'Automation');
  await page.getByRole('navigation', { name: 'Actions' }).getByRole('button', { name: /^Count deaths/ }).click();
  const canvas = page.getByRole('region', { name: 'Flow of Count deaths' });
  const box = (await canvas.boundingBox())!;
  await page.mouse.dblclick(box.x + 200, box.y + box.height - 200);
  const picker = page.getByRole('dialog', { name: 'Add a step' });
  await picker.getByRole('textbox').fill('soundboard');
  await picker.getByRole('option', { name: /^Play soundboard sound/ }).click();
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await inspector.getByRole('combobox', { name: 'Button' }).selectOption({ label: '👏 Applause' });
  await expect(page.locator('[data-node]', { hasText: '👏 Applause' })).toBeVisible();
  expect(errors).toEqual([]);
});
