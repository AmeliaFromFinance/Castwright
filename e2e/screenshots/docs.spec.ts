import { test, type Page } from '@playwright/test';
import { fixture, stubProviders } from '../providers';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = (name: string) => fileURLToPath(new URL(`../../docs-site/src/assets/screens/${name}.png`, import.meta.url));

/** Emote lists and 7TV styles come from saved data; the images themselves are real. */
async function providers(page: Page) {
  await stubProviders(page, {
    seventvGlobal: fixture('7tv-global'),
    seventvUser: fixture('7tv-user'),
    bttvGlobal: fixture('bttv-global'),
    bttvUser: fixture('bttv-user'),
    ffzGlobal: fixture('ffz-global'),
    ffzRoom: fixture('ffz-room'),
    styles: {
      '1000': { paint: '01JHXJFACX42RV996VE9933TB8', badge: '01JJJ74CRHZBRMCM8F4Y2WBN6R' },
      '1002': { paint: '01GHA42XER0001KT343YQ6DM2E' },
      '1005': { paint: '01HQE7KJWG0000D7GK7EKRAPN3', badge: '01GAF8RWW8000E8VNG1S1RMTBA' },
      '1003': { badge: '01GAF8RWW8000E8VNG1S1RMTBA' }
    },
    cosmetics: fixture('7tv-cosmetics')
  });
  if (process.env.HTTPS_PROXY) {
    await page.unroute(/^https:\/\/cdn\.(7tv\.app|betterttv\.net|frankerfacez\.com)\//);
    await page.unroute('https://static-cdn.jtvnw.net/badges/**');
  }
}

async function open(page: Page, query = 'demo=static') {
  await providers(page);
  await page.goto(`/?${query}`);
  await page.locator('.splash').waitFor({ state: 'detached' });
  await page.waitForTimeout(600);
}

async function nav(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name }).click();
  await page.waitForTimeout(500);
}

async function shot(page: Page, name: string) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: out(name) });
}


test('light theme', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+Comma');
  await page.getByRole('button', { name: 'Appearance' }).click();
  await page.getByRole('radio', { name: /Castwright Light/ }).click();
  await nav(page, 'Overlays');
  await page.locator('[data-overlay-card]').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await shot(page, 'light-theme');
});

test('activity', async ({ page }) => {
  await open(page);
  await nav(page, 'Activity');
  await page.locator('tbody tr').nth(3).click();
  await shot(page, 'activity');
});

test('session summary', async ({ page }) => {
  await open(page, 'demo=static&ended');
  await page.getByRole('button', { name: 'View' }).click();
  await page.getByRole('article', { name: 'Stream summary' }).locator('svg path').first().waitFor();
  await shot(page, 'session-summary');
});

test('summary with markers and clips', async ({ page }) => {
  await open(page);
  const palette = async (command: string) => {
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search commands' }).fill(command);
    await page.keyboard.press('Enter');
  };
  await palette('add stream marker');
  await page.getByRole('textbox', { name: 'Marker note' }).fill('Final boss, first try');
  await page.keyboard.press('Enter');
  await palette('create clip');
  await page.getByRole('status', { name: 'Clip ready' }).waitFor();
  await palette('last stream summary');
  const dialog = page.getByRole('dialog', { name: 'Stream summary' });
  await dialog.getByRole('region', { name: 'Markers' }).getByText('Final boss, first try').waitFor();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  await dialog.screenshot({ path: out('summary-markers-clips') });
});

test('update download', async ({ page }) => {
  await open(page, 'demo=static&update=downloading');
  await page.locator('footer.status').getByRole('button', { name: /is out/ }).click();
  const dialog = page.getByRole('dialog', { name: /is out/ });
  await dialog.getByRole('button', { name: 'Download and install' }).click();
  await dialog.getByText(/· 45%/).waitFor();
  await shot(page, 'update-download');
});

test('status bar more', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, 'demo=static&busy');
  const status = page.getByRole('contentinfo', { name: 'Status' });
  await status.locator('[data-key="update:full"] button[aria-label="Downloading update, 45%"]').waitFor({ state: 'attached' });
  // Everything fits at 1280 and 100%, so zoom to 125%.
  await page.keyboard.press('Control+Equal');
  await page.keyboard.press('Control+Equal');
  await page.waitForTimeout(1800);
  await status.getByRole('button', { name: /^\d+ more$/ }).click();
  await page.getByRole('dialog', { name: 'More status items' }).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('status-bar-more') });
});

test('settings', async ({ page }) => {
  await open(page);
  await nav(page, 'Settings');
  await shot(page, 'settings');
});

test('theme editor', async ({ page }) => {
  await open(page);
  await nav(page, 'Settings');
  await page.getByRole('button', { name: 'Appearance' }).click();
  await page.getByRole('button', { name: 'New theme' }).click();
  await page.locator('#theme-name').fill('Sunset');
  await page.getByRole('button', { name: 'Hue 25' }).click();
  await page.waitForTimeout(300);
  await page.locator('#appearance').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await shot(page, 'theme-editor');
});

test('first run', async ({ page }) => {
  await open(page, 'demo=static&setup');
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: 'Sign in with Twitch' }).click();
  await page.getByText('WDJB-MJHT').waitFor();
  await shot(page, 'first-run');
});

test('high contrast', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+Comma');
  await page.getByRole('button', { name: 'Appearance' }).click();
  await page.getByRole('radio', { name: /^High contrast\b(?! light)/ }).click();
  await nav(page, 'Alerts');
  await shot(page, 'high-contrast');
});

test('overlays', async ({ page }) => {
  await open(page);
  await nav(page, 'Overlays');
  await page.getByRole('button', { name: 'New overlay' }).first().click();
  const dlg = page.getByRole('dialog', { name: 'New overlay' });
  await dlg.locator('label', { has: dlg.page().getByRole('radio', { name: 'Just Chatting', exact: true }) }).click();
  await dlg.getByRole('button', { name: 'Create overlay' }).click();
  await page.getByRole('button', { name: 'Back to overlays' }).click();
  await page.waitForTimeout(800);
  await shot(page, 'overlays');
});

test('overlay templates', async ({ page }) => {
  await open(page);
  await nav(page, 'Overlays');
  await page.getByRole('button', { name: 'New overlay' }).first().click();
  const dlg = page.getByRole('dialog', { name: 'New overlay' });
  await dlg.locator('label', { has: dlg.page().getByRole('radio', { name: 'Starting soon', exact: true }) }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: out('overlay-templates') });
});

test('overlay editor', async ({ page }) => {
  await open(page);
  await nav(page, 'Overlays');
  await page.locator('[data-overlay-card]').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('[data-layer-row]').first().click();
  await shot(page, 'overlay-editor');
});

test('overlay editor alert test', async ({ page }) => {
  await open(page);
  await nav(page, 'Overlays');
  await page.getByRole('button', { name: 'New overlay' }).first().click();
  const dlg = page.getByRole('dialog', { name: 'New overlay' });
  await dlg.getByLabel('Name', { exact: true }).fill('Starter');
  await dlg.locator('label', { has: dlg.page().getByRole('radio', { name: 'Gameplay', exact: true }) }).click();
  await dlg.getByRole('button', { name: 'Create overlay' }).click();
  await page.getByRole('button', { name: 'Test' }).click();
  await page.getByLabel('Play an alert').selectOption('raid');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  await shot(page, 'overlay-editor-alert');
});

test('custom widget', async ({ page }) => {
  await open(page);
  await nav(page, 'Overlays');
  await page.locator('[data-overlay-card]').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Add custom widget layer' }).click();
  await page.getByRole('tablist', { name: 'Widget code' }).getByRole('tab', { name: 'JS' }).click();
  await shot(page, 'custom-widget');
});

test('alerts', async ({ page }) => {
  await open(page);
  await nav(page, 'Alerts');
  await page.getByRole('button', { name: /^Subscription/ }).click();
  await page.locator('[data-variation]').first().getByRole('button').first().click();
  await page.waitForTimeout(600);
  await shot(page, 'alerts');
});

test('automation', async ({ page }) => {
  await open(page);
  await nav(page, 'Automation');
  await page.getByText('Big raid welcome', { exact: true }).first().click();
  await page.waitForTimeout(600);
  await shot(page, 'automation');
});

test('variable details', async ({ page }) => {
  await open(page);
  await nav(page, 'Automation');
  await page.getByText('Count deaths', { exact: true }).first().click();
  await page.waitForTimeout(400);
  await page.getByRole('region', { name: 'Variables' }).getByRole('button', { name: 'counter.deaths details' }).click();
  await page.getByRole('dialog', { name: 'counter.deaths' }).waitFor();
  await shot(page, 'variable-details');
});

test('import actions', async ({ page }, info) => {
  await open(page);
  await nav(page, 'Automation');
  await page.getByRole('navigation', { name: 'Actions' }).locator('li').filter({ hasText: 'Count deaths' }).click({ button: 'right' });
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Export…' }).click()]);
  const pkg = JSON.parse(readFileSync((await file.path())!, 'utf8'));
  // As if it came from another project: a layer and a sound that aren't here.
  const a = pkg.actions[0];
  const last = a.graph.nodes[a.graph.nodes.length - 1];
  const step = (id: string, dy: number, s: object) => ({ id, x: last.x, y: last.y + dy, kind: { type: 'step', step: s } });
  a.graph.nodes.push(
    step('n-layer', 136, { type: 'set_layer_visible', overlay_id: 'x-main', layer_id: 'x-chat', state: 'on' }),
    step('n-sound', 272, { type: 'play_sound', src: 'assets/airhorn.mp3', volume: 80 })
  );
  const edge = (id: string, from: string, to: string) => ({ id, from, from_side: 'bottom', to, to_side: 'top', branch: 'next' });
  a.graph.edges.push(edge('e-1', last.id, 'n-layer'), edge('e-2', 'n-layer', 'n-sound'));
  pkg.refs.push(
    { kind: 'layer', id: 'x-chat', name: 'Chat', overlay_id: 'x-main', overlay_name: 'Main' },
    { kind: 'asset', id: 'airhorn.mp3', name: 'airhorn.mp3', overlay_id: '', overlay_name: '' }
  );
  const path = info.outputPath('count-deaths.cwactions');
  writeFileSync(path, JSON.stringify(pkg));
  await page.getByLabel('Actions file to import').setInputFiles(path);
  await page.getByRole('dialog', { name: 'Import actions' }).waitFor();
  await page.waitForTimeout(3500);
  await shot(page, 'import-actions');
});

test('chat with 7TV', async ({ page }) => {
  await open(page);
  await nav(page, 'Activity');
  await page.getByRole('radio', { name: 'Chat' }).click();
  await page.waitForTimeout(2500);
  await shot(page, 'chat');
});

async function openChat(page: Page) {
  await open(page);
  await nav(page, 'Activity');
  await page.getByRole('radio', { name: 'Chat' }).click();
  await page.waitForTimeout(2500);
  return page.getByRole('listbox', { name: 'Chat messages' });
}

test('mod tools', async ({ page }) => {
  const chat = await openChat(page);
  const msg = chat.getByRole('option', { name: /^nova_kat:/ }).nth(1);
  await msg.hover();
  await msg.getByRole('button', { name: 'Message actions' }).click();
  await page.getByRole('menu', { name: /Message actions for nova_kat/ }).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('mod-tools') });
});

test('viewer card', async ({ page }) => {
  const chat = await openChat(page);
  await chat.getByRole('option', { name: /^nova_kat:/ }).last().getByRole('button', { name: 'nova_kat' }).click();
  const card = page.getByRole('dialog', { name: 'Viewer card: nova_kat' });
  await card.getByLabel('Mod note').fill('Regular, asks good questions');
  await page.waitForTimeout(600);
  await shot(page, 'viewer-card');
});

test('scene preview', async ({ page }) => {
  await open(page);
  await nav(page, 'Overlays');
  await page.locator('[data-overlay-card]').first().getByRole('button', { name: 'Edit', exact: true }).click();
  const row = page.locator('[data-layer-row]').filter({ has: page.locator('.name', { hasText: /^Chat$/ }) });
  await row.locator('button.pick').click();
  const props = page.getByRole('complementary', { name: 'Properties' });
  await props.getByRole('button', { name: 'Scenes' }).click();
  await props.getByLabel('Show', { exact: true }).selectOption('only');
  await props.getByRole('checkbox', { name: 'Gameplay' }).check();
  await props.getByRole('checkbox', { name: 'Just Chatting' }).check();
  await page.getByLabel('Preview as scene').selectOption('BRB');
  await page.waitForTimeout(2500);
  await shot(page, 'overlay-scenes');
});

test('alert controls', async ({ page }) => {
  await open(page);
  const status = page.getByRole('contentinfo', { name: 'Status' });
  const trigger = status.getByRole('button', { name: /^Alert controls/ });
  await trigger.click();
  const pop = page.getByRole('dialog', { name: 'Alert controls' });
  await pop.getByRole('button', { name: 'Pause alerts' }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('test follow alert');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  await trigger.click();
  await pop.getByRole('button', { name: 'Mute alert sound' }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out('alert-controls') });
});

test('go-live check', async ({ page }) => {
  await open(page);
  const status = page.getByRole('contentinfo', { name: 'Status' });
  await status.getByRole('button', { name: /^Alert controls/ }).click();
  const pop = page.getByRole('dialog', { name: 'Alert controls' });
  await pop.getByRole('button', { name: 'Pause alerts' }).click();
  await pop.getByRole('button', { name: 'Mute alert sound' }).click();
  await page.keyboard.press('Escape');
  await status.getByRole('button', { name: 'Go-live check' }).click();
  const dlg = page.getByRole('dialog', { name: 'Go-live check' });
  await dlg.getByRole('checkbox', { name: 'Mic on and not muted' }).check();
  await page.waitForTimeout(1500);
  await shot(page, 'golive-check');
});

test('health', async ({ page }) => {
  await open(page);
  await page.getByRole('contentinfo', { name: 'Status' }).getByRole('button', { name: /^Health:/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Health' });
  await dialog.getByRole('heading', { name: 'Recent problems' }).waitFor();
  await page.waitForTimeout(600);
  // Taller window so every section fits without scrolling.
  await page.setViewportSize({ width: 1440, height: 1040 });
  await page.waitForTimeout(400);
  await shot(page, 'health');
});

test('bug report', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('save bug report');
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: 'Save a bug report' }).getByRole('list', { name: 'Files in the report' }).waitFor();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await shot(page, 'bug-report');
});

test('comic chat cards', async ({ page }) => {
  await open(page);
  await nav(page, 'Overlays');
  await page.locator('[data-overlay-card]').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('[data-layer-row]').filter({ hasText: 'Chat' }).locator('.pick').click();
  await page.getByRole('button', { name: /^Cards/ }).click();
  await page.getByRole('list', { name: 'Styles' }).first().getByRole('button', { name: /^Comic style/ }).click();
  await page.waitForTimeout(2500);
  await shot(page, 'styles');
});

test('alert styles', async ({ page }) => {
  await open(page);
  await nav(page, 'Alerts');
  await page.getByRole('button', { name: /^Follow/ }).click();
  const card = page.locator('[data-variation]').first();
  const styles = card.getByRole('button', { name: 'Styles', exact: true });
  if (!(await styles.isVisible())) await card.locator('button.expand').click();
  await styles.click();
  await card.getByRole('button', { name: /^Neon style/ }).click();
  await page.getByText('Styles', { exact: true }).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  await shot(page, 'alert-styles');
});

test('command palette', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('test');
  await shot(page, 'palette');
});

test('channel points', async ({ page }) => {
  await open(page);
  await nav(page, 'Interact');
  await page.getByRole('radio', { name: 'Channel points' }).click();
  await page.locator('[data-reward="Hydrate"]').waitFor();
  await shot(page, 'interact-rewards');
});

test('polls and predictions', async ({ page }) => {
  await open(page);
  await nav(page, 'Interact');
  await page.getByRole('radio', { name: 'Polls & predictions' }).click();
  await page.getByText('Clutch this round?').waitFor();
  await shot(page, 'interact-polls');
});

test('poll layer', async ({ page }) => {
  await open(page);
  await nav(page, 'Overlays');
  await page.locator('[data-overlay-card]').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Add poll / prediction layer' }).click();
  await page.locator('.cw-stage .cw-poll').waitFor();
  await shot(page, 'interact-poll-layer');
});

test('credits layer', async ({ page }) => {
  await open(page);
  await nav(page, 'Overlays');
  await page.getByRole('button', { name: 'New overlay' }).first().click();
  const dlg = page.getByRole('dialog', { name: 'New overlay' });
  await dlg.getByLabel('Name', { exact: true }).fill('Ending');
  await dlg.locator('label', { has: dlg.page().getByRole('radio', { name: 'Ending', exact: true }) }).click();
  await dlg.getByRole('button', { name: 'Create overlay' }).click();
  await page.locator('[data-layer-row]').filter({ hasText: 'Credits' }).click();
  await page.getByRole('radio', { name: 'Like chat' }).click();
  await page.getByRole('button', { name: 'Roll now' }).click();
  await page.waitForTimeout(15000);
  await shot(page, 'credits-layer');
});

test('action templates', async ({ page }) => {
  await open(page);
  await nav(page, 'Automation');
  await page.getByRole('button', { name: 'New action' }).click();
  await page.getByRole('dialog', { name: 'New action' }).locator('.mini svg').last().waitFor();
  await shot(page, 'action-templates');
});

test('ad popover', async ({ page }) => {
  await open(page);
  const status = page.getByRole('contentinfo', { name: 'Status' });
  await status.getByRole('button', { name: /^Ad in / }).click();
  await page.getByTestId('ad-popover').waitFor();
  await shot(page, 'ads-popover');
});

test('ad break layer', async ({ page }) => {
  await open(page);
  await nav(page, 'Overlays');
  await page.locator('[data-overlay-card]').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Add ad break layer' }).click();
  await page.getByRole('radio', { name: 'During the ad' }).click();
  await page.locator('.cw-stage .cw-ad-running').waitFor();
  await page.getByRole('button', { name: /^Cards/ }).click();
  await page.getByRole('list', { name: 'Styles' }).first().getByRole('button', { name: /^Neon style/ }).click();
  await page.getByRole('button', { name: /^Cards/ }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await shot(page, 'ad-break-layer');
});

test('discord settings', async ({ page }) => {
  await open(page);
  await nav(page, 'Settings');
  await page.getByRole('button', { name: 'Discord', exact: true }).click();
  await page.locator('[data-webhook]').first().waitFor();
  await page.waitForTimeout(800);
  await shot(page, 'discord-settings');
});

test('now playing layer', async ({ page }) => {
  await open(page);
  await nav(page, 'Overlays');
  await page.locator('[data-overlay-card]').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Add now playing layer' }).click();
  await page.getByRole('spinbutton', { name: 'Width', exact: true }).fill('820');
  await page.getByRole('spinbutton', { name: 'Height', exact: true }).fill('210');
  await page.getByRole('spinbutton', { name: 'X position' }).fill('48');
  await page.getByRole('spinbutton', { name: 'Y position' }).fill('600');
  await page.getByRole('spinbutton', { name: 'Font size' }).fill('38');
  await page.getByRole('radio', { name: 'Vinyl' }).click();
  await page.getByRole('switch', { name: 'Album' }).click();
  await page.locator('.cw-stage .cw-np-vinyl').waitFor();
  await page.getByRole('radio', { name: 'Vinyl' }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await shot(page, 'now-playing-layer');
});

test('chat highlights', async ({ page }) => {
  const chat = await openChat(page);
  await page.getByRole('button', { name: 'Chat display options' }).click();
  await page.getByRole('switch', { name: 'Show hidden as a line' }).click();
  await chat.getByRole('option', { name: /^river_dev:/ }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await page.screenshot({ path: out('chat-highlights') });
});

test('music settings', async ({ page }) => {
  await open(page);
  await nav(page, 'Settings');
  await page.getByRole('button', { name: 'Music', exact: true }).click();
  await page.locator('#music').getByText('Signed in as Demo listener').waitFor();
  await page.waitForTimeout(800);
  await shot(page, 'music-settings');
});

test('hype train layer', async ({ page }) => {
  await open(page, 'demo=static&hype');
  await nav(page, 'Overlays');
  await page.locator('[data-overlay-card]').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Add hype train layer' }).click();
  await page.getByRole('spinbutton', { name: 'Width', exact: true }).fill('760');
  await page.getByRole('spinbutton', { name: 'Height', exact: true }).fill('200');
  await page.getByRole('spinbutton', { name: 'X position' }).fill('48');
  await page.getByRole('spinbutton', { name: 'Y position' }).fill('620');
  await page.getByRole('spinbutton', { name: 'Font size' }).fill('34');
  await page.locator('.cw-stage .cw-hype-card .cw-hype-timer').waitFor();
  await page.getByRole('radio', { name: 'Bar' }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  await shot(page, 'hype-train-layer');
});

test('soundboard', async ({ page }) => {
  await open(page);
  await nav(page, 'Interact');
  await page.getByRole('radio', { name: 'Soundboard', exact: true }).click();
  const board = page.getByRole('region', { name: 'Soundboard' });
  // One sound cooling down, one playing.
  await board.getByRole('button', { name: 'Play Airhorn' }).click();
  await board.getByRole('button', { name: 'Play Airhorn' }).getByLabel(/Cooldown/).waitFor({ timeout: 6000 });
  await board.getByRole('button', { name: 'Play Drum roll' }).click();
  await board.getByRole('button', { name: 'Stop Drum roll' }).waitFor();
  await page.waitForTimeout(600);
  await board.locator('li[data-sound="Applause"]').hover();
  await board.getByRole('button', { name: 'Edit Applause' }).click();
  await page.getByRole('dialog', { name: 'Edit sound' }).getByText('Stream Deck').waitFor();
  await shot(page, 'soundboard');
});

test('giveaway panel', async ({ page }) => {
  await open(page);
  await nav(page, 'Interact');
  await page.getByRole('radio', { name: 'Giveaways' }).click();
  const form = page.getByRole('form', { name: 'New giveaway' });
  await form.getByLabel('Prize').fill('Mechanical keyboard');
  await form.getByLabel('Entries per sub').fill('2');
  await form.getByRole('switch', { name: 'Tier 2 and 3 subs get 2× and 3× that' }).click();
  await form.getByRole('button', { name: 'Open giveaway' }).click();
  const live = page.getByRole('region', { name: 'Running giveaway' });
  await page.waitForTimeout(9000);
  await live.getByRole('button', { name: 'Draw winner' }).click();
  await page.waitForTimeout(4500);
  await shot(page, 'giveaway-panel');
});

test('giveaway layer', async ({ page }) => {
  await open(page);
  await nav(page, 'Overlays');
  await page.locator('[data-overlay-card]').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Add giveaway layer' }).click();
  await page.getByLabel('X position').fill('140');
  await page.getByLabel('Y position').fill('420');
  await page.getByLabel('X position').press('Enter');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Spin the sample' }).click();
  await page.locator('.cw-stage .cw-gw-window[data-phase="landed"]').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  await shot(page, 'giveaway-layer');
});

test('queue panel', async ({ page }) => {
  await open(page);
  await nav(page, 'Interact');
  await page.getByRole('radio', { name: 'Queue' }).click();
  await page.getByRole('switch', { name: 'Queue open' }).click();
  await page.waitForTimeout(12_000);
  await page.getByRole('button', { name: /^Next/ }).click();
  await page.waitForTimeout(1000);
  await shot(page, 'queue-panel');
});
