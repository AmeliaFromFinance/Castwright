import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { alert, chat, event, overlay } from './fixture';
import { startServer, type MiniSocket, type TestServer } from './test-server';
import { fixture, stubProviders, type ProviderData } from '../providers';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const outDir = join(root, 'e2e/.output/overlay-dist');
const screens = join(here, '__screens__');
const TOKEN = 'tok en&1';

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9db8ff"/><stop offset="1" stop-color="#c9b3ff"/></linearGradient></defs><circle cx="32" cy="32" r="28" fill="url(#g)"/><path d="M22 34l7 7 14-16" stroke="#0c0f16" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
// 1x1 PNG used for emotes so the test never reaches the network.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function silentWav(ms = 100, rate = 8000): Buffer {
  const samples = Math.round((rate * ms) / 1000);
  const b = Buffer.alloc(44 + samples);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + samples, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write('data', 36);
  b.writeUInt32LE(samples, 40);
  b.fill(128, 44);
  return b;
}

function makeClip(): Buffer | null {
  const file = join(root, 'e2e/.output/clip.webm');
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=192x168:rate=15', '-t', '2', '-c:v', 'libvpx', '-b:v', '300k', file]);
    return readFileSync(file);
  } catch {
    return null;
  }
}

let server: TestServer;
let errors: string[] = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(180_000);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(root, 'e2e/.output'), { recursive: true });
  // Only the overlay entry, so this suite doesn't depend on the app shell.
  await build({
    root,
    configFile: join(root, 'vite.config.ts'),
    logLevel: 'warn',
    build: { outDir, emptyOutDir: true },
    plugins: [
      {
        name: 'overlay-only',
        config(c) {
          const b = (c.build ??= {}) as { rollupOptions?: { input?: unknown }; rolldownOptions?: { input?: unknown } };
          const input = { overlay: join(root, 'overlay.html') };
          if (b.rolldownOptions) b.rolldownOptions.input = input;
          b.rollupOptions = { ...(b.rollupOptions ?? {}), input };
        }
      }
    ]
  });
  const assets: Record<string, Buffer | string> = { 'logo.svg': LOGO_SVG, 'ding.wav': silentWav() };
  const clip = makeClip();
  if (clip) assets['clip.webm'] = clip;
  server = await startServer({ distDir: outDir, token: TOKEN, assets });
});

test.afterAll(async () => {
  await server?.close();
});

async function open(page: Page, providers: ProviderData = {}): Promise<MiniSocket> {
  errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '/* fonts stubbed */' }));
  await stubProviders(page, providers);
  await page.route('https://static-cdn.jtvnw.net/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.setViewportSize({ width: 1280, height: 720 });
  const socket = server.nextSocket();
  await page.goto(`${server.url}/overlay/ov1?token=${encodeURIComponent(TOKEN)}`);
  return socket;
}

function hello(extra: Record<string, unknown> = {}) {
  return {
    type: 'hello',
    overlay: overlay(),
    vars: { 'stream.title': 'Speedrun night', 'session.subs': 3, 'counter.deaths': 4, 'stream.started_at': Date.now() - 3_723_000 },
    recent: [event('follow', { user: { id: 'f1', login: 'pixelbyte', display_name: 'pixelbyte' } }), event('cheer', { amount: 500 })],
    chat: [chat('hey all, gl on the run!', { data: { color: '#1E90FF' }, roles: { broadcaster: false, moderator: true, vip: false, subscriber: true } })],
    widget_state: { widget: { hits: { n: 5 } } },
    ...extra
  };
}

const layer = (page: Page, id: string) => page.locator(`[data-layer-id="${id}"]`);

test('renders every layer type and follows live updates', async ({ page }) => {
  const ws = await open(page);
  const sock = await ws;
  expect(new URL(page.url()).pathname).toBe('/overlay/ov1');
  sock.send(hello());

  // Static layers
  await expect(layer(page, 'title')).toContainText('Speedrun night');
  await expect(layer(page, 'deaths')).toContainText('Deaths: 4');
  await expect(layer(page, 'countdown')).toContainText(/Break (10:00|09:5\d)/);
  await expect(layer(page, 'uptime')).toContainText(/Live 1:02:0\d/);
  await expect(layer(page, 'goal')).toContainText('3 / 10');
  await expect(layer(page, 'goal').locator('.cw-goal-fill')).toHaveAttribute('data-pct', '30.00');
  await expect(layer(page, 'logo').locator('img')).toHaveAttribute('src', `${server.url}/assets/logo.svg?token=${encodeURIComponent(TOKEN)}`);
  await expect(layer(page, 'events')).toContainText('pixelbyte · followed');
  await expect(layer(page, 'events')).toContainText('cheered 500 bits');
  await expect(layer(page, 'ticker')).toContainText('pixelbyte followed');
  await expect(layer(page, 'chat')).toContainText('gl on the run');
  await expect(layer(page, 'chat').locator('svg[aria-label="Moderator"]')).toHaveCount(1);
  await expect(layer(page, 'live-badge')).toHaveCount(0);
  const stage = page.locator('.cw-stage');
  await expect(stage).toHaveCSS('width', '1280px');
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // Custom widget: onWidgetLoad with field values and seeded store
  const widget = page.frameLocator('[data-layer-id="widget"] iframe');
  await expect(widget.locator('#status')).toHaveText('loaded:Hi there');
  await expect(widget.locator('#hits')).toHaveText('hits:5');
  await expect(widget.locator('p')).toHaveText('Hi there');
  await expect(layer(page, 'widget').locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  // Widget code can't read the token from its base URL.
  const frame = page.frames().find((f) => f.url().startsWith('about:srcdoc'));
  expect(frame).toBeTruthy();
  const leaked = await frame!.evaluate(() => document.baseURI + ' ' + location.href);
  expect(leaked).not.toContain('token');

  // Events reach lists and the widget; the widget's store write reaches the server
  const follow = event('follow', { user: { id: 'f2', login: 'lumenlark', display_name: 'LumenLark' } });
  sock.send({ type: 'event', event: follow });
  sock.send({ type: 'vars', changes: { 'session.follows': 1 } });
  await expect(layer(page, 'events').locator('.cw-list-item').first()).toContainText('LumenLark · followed');
  await expect(widget.locator('#last')).toHaveText('follow:LumenLark');
  await expect(widget.locator('#session')).toHaveText('follows:1');
  await expect.poll(() => sock.received).toContainEqual({ type: 'store_set', layer_id: 'widget', key: 'hits', value: { n: 6, by: 'LumenLark' } });

  // Chat: add, filter, delete, clear by user
  const line = chat('that stinger is so clean Kappa', {
    message_parts: [
      { type: 'text', text: 'that stinger is so clean ' },
      { type: 'emote', text: 'Kappa', id: '25' }
    ],
    data: { color: '#000010' },
    roles: { broadcaster: false, moderator: false, vip: true, subscriber: false }
  });
  sock.send({ type: 'event', event: line });
  await expect(widget.locator('#chat')).toHaveText('msg:that stinger is so clean Kappa');
  sock.send({ type: 'event', event: chat('!discord') });
  sock.send({ type: 'event', event: chat('bot spam', { user: { id: 'nb', login: 'nightbot', display_name: 'Nightbot' } }) });
  const chatLine = layer(page, 'chat').locator(`[data-msg-id="${line.id}"]`);
  await expect(chatLine).toContainText('that stinger is so clean');
  await expect(chatLine.locator('img.cw-emote')).toHaveAttribute('src', 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0');
  // A near-black name colour is lightened to stay readable.
  const nameColor = await chatLine.locator('.cw-chat-name').evaluate((el) => getComputedStyle(el).color);
  expect(nameColor).not.toBe('rgb(0, 0, 16)');
  await expect(layer(page, 'chat')).not.toContainText('!discord');
  await expect(widget.locator('#chat')).toHaveText('msg:bot spam');
  await expect(layer(page, 'chat')).not.toContainText('bot spam');
  sock.send({ type: 'chat_delete', message_id: line.id });
  await expect(chatLine).toHaveCount(0);
  await expect(widget.locator('#chat')).toHaveText(`deleted:${line.id}`);

  // Variables: goal, counter, conditional layer
  sock.send({ type: 'vars', changes: { 'session.subs': 8, 'counter.deaths': 5, 'stream.live': true } });
  await expect(layer(page, 'goal').locator('.cw-goal-fill')).toHaveAttribute('data-pct', '80.00');
  await expect(layer(page, 'goal').locator('.cw-goal-fill')).toHaveAttribute('style', /width:\s*80%/);
  await expect(layer(page, 'goal')).toContainText('8 / 10');
  await expect(layer(page, 'deaths')).toContainText('Deaths: 5');
  await expect(layer(page, 'live-badge')).toContainText('LIVE');

  // Alert: shows, then exits on its own by duration + exit
  const a = alert();
  const shownAt = Date.now();
  sock.send({ type: 'alert_play', play: a });
  const card = page.locator(`[data-alert-id="${a.id}"]`);
  await expect(card).toBeVisible();
  await expect(card).toContainText('Nova_Kat subscribed!');
  await expect(card).toContainText('Tier 1 · first month');
  const media = await card.locator('.cw-alert-media img').boundingBox();
  expect(media?.width).toBeGreaterThan(50);
  expect(media?.height).toBeGreaterThan(50);
  await page.waitForTimeout(500);
  mkdirSync(screens, { recursive: true });
  await stage.screenshot({ path: join(screens, 'stage-alert.png'), omitBackground: true });
  await expect(card).toHaveCount(0, { timeout: 4000 });
  const gone = Date.now() - shownAt;
  expect(gone).toBeGreaterThanOrEqual(1500);
  expect(gone).toBeLessThan(3500);

  // alert_stop ends it early; a new alert_play replaces the current one
  const b = alert({ duration_ms: 20_000, layout: 'media_left', title: 'Raid incoming!' });
  sock.send({ type: 'alert_play', play: b });
  await expect(page.locator(`[data-alert-id="${b.id}"]`)).toBeVisible();
  await page.waitForTimeout(500);
  await stage.screenshot({ path: join(screens, 'stage-alert-media-left.png'), omitBackground: true });
  const c = alert({ duration_ms: 20_000, layout: 'text_only', title: 'Replaced' });
  sock.send({ type: 'alert_play', play: c });
  await expect(page.locator(`[data-alert-id="${b.id}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-alert-id="${c.id}"]`)).toContainText('Replaced');
  sock.send({ type: 'alert_stop', id: c.id });
  await expect(page.locator(`[data-alert-id="${c.id}"]`)).toHaveCount(0, { timeout: 1500 });

  // layer_visible, play_sound
  sock.send({ type: 'layer_visible', layer_id: 'deaths', visible: false });
  await expect(layer(page, 'deaths')).toHaveCount(0);
  sock.send({ type: 'play_sound', src: 'assets/ding.wav', volume: 30 });

  await stage.screenshot({ path: join(screens, 'stage.png'), omitBackground: true });
  expect(errors).toEqual([]);
});

test('keeps the picture through a reconnect and applies the new hello', async ({ page }) => {
  const first = await (await open(page));
  first.send(hello());
  await expect(layer(page, 'title')).toContainText('Speedrun night');
  await expect(page.frameLocator('[data-layer-id="widget"] iframe').locator('#status')).toHaveText('loaded:Hi there');

  const next = server.nextSocket();
  first.close();
  await page.waitForTimeout(200);
  // Still on screen while disconnected.
  await expect(layer(page, 'title')).toContainText('Speedrun night');
  const sock = await next;
  const o = overlay();
  o.layers = o.layers.filter((l) => l.id !== 'title');
  sock.send(hello({ overlay: o, chat: [], vars: { 'session.subs': 10 } }));
  await expect(layer(page, 'title')).toHaveCount(0);
  await expect(layer(page, 'chat').locator('.cw-chat-line')).toHaveCount(0);
  await expect(layer(page, 'goal').locator('.cw-goal-fill')).toHaveAttribute('data-pct', '100.00');

  // Layout update keeps the page running and adds the new layer.
  o.layers.push({ ...o.layers.find((l) => l.id === 'deaths')!, id: 'deaths-2', y: 560, x: 528 });
  sock.send({ type: 'overlay', overlay: o });
  await expect(layer(page, 'deaths-2')).toContainText('Deaths: 0');
  expect(errors.filter((e) => !/WebSocket/.test(e))).toEqual([]);
});

test('shows 7TV, BetterTTV and Twitch emotes, 7TV paints and badges', async ({ page }) => {
  const EMERALD = '01JHXJFACX42RV996VE9933TB8';
  const GINGER = '01GHA42XER0001KT343YQ6DM2E';
  let events: { ws: import('@playwright/test').WebSocketRoute; subscribed: unknown[] } | null = null;
  const sock = await (await open(page, {
    seventvGlobal: fixture('7tv-global'),
    seventvUser: fixture('7tv-user'),
    bttvGlobal: fixture('bttv-global'),
    cosmetics: fixture('7tv-cosmetics'),
    styles: { '71092938': { paint: EMERALD, badge: '01JJJ74CRHZBRMCM8F4Y2WBN6R' }, '9001': { paint: GINGER } },
    onEvents: (ws, subscribed) => (events = { ws, subscribed })
  }));
  const badge = (set_id: string) => ({ set_id, id: '1', title: set_id, url_1x: `https://static-cdn.jtvnw.net/badges/v1/${set_id}/1`, url_2x: `https://static-cdn.jtvnw.net/badges/v1/${set_id}/2`, url_4x: `https://static-cdn.jtvnw.net/badges/v1/${set_id}/3` });
  const a = chat('GAMBA notL nice peepoHappy', {
    user: { id: '71092938', login: 'xqc', display_name: 'xQc' },
    data: { color: '#1E90FF', badges: ['moderator', 'founder'], badge_images: [badge('moderator')] },
    roles: { broadcaster: false, moderator: true, vip: false, subscriber: true }
  });
  const b = chat('that was close monkaS, Kappa RainTime', {
    user: { id: '9001', login: 'nova', display_name: 'Nova' },
    data: { color: '#FF7F50' },
    message_parts: [
      { type: 'text', text: 'that was close monkaS, ' },
      { type: 'emote', text: 'Kappa', id: '25' },
      { type: 'text', text: ' RainTime' }
    ]
  });
  sock.send(hello({ chat: [a, b], vars: { 'twitch.user_id': '71092938' } }));

  const lineA = layer(page, 'chat').locator(`[data-msg-id="${a.id}"]`);
  const lineB = layer(page, 'chat').locator(`[data-msg-id="${b.id}"]`);
  // Text shows straight away; emotes replace words once the lists arrive.
  await expect(lineA).toContainText('nice');
  const gamba = lineA.locator('img.cw-emote-7tv[alt="GAMBA"]');
  await expect(gamba).toBeVisible();
  await expect(gamba).toHaveAttribute('srcset', /cdn\.7tv\.app\/emote\/\w+\/1x\.webp 39w, .*4x\.webp 156w$/);
  const stack = lineA.locator('.cw-emote-stack');
  await expect(stack.locator('img')).toHaveCount(2);
  await expect(stack.locator('img.cw-emote-zw')).toHaveAttribute('alt', 'notL');
  const [g, z] = await Promise.all([gamba.boundingBox(), stack.locator('.cw-emote-zw').boundingBox()]);
  expect(Math.abs(g!.x + g!.width / 2 - (z!.x + z!.width / 2))).toBeLessThan(1.5);
  await expect(lineA.locator('img.cw-emote-7tv[alt="peepoHappy"]')).toBeVisible();
  await expect(lineB.locator('img.cw-emote-bttv[alt="monkaS"]')).toBeVisible();
  await expect(lineB).toContainText('that was close , ');
  await expect(lineB.locator('.cw-emote-stack img.cw-emote-twitch')).toHaveAttribute('alt', 'Kappa');
  await expect(lineB.locator('.cw-emote-stack img.cw-emote-zw')).toHaveAttribute('alt', 'RainTime');

  // Badges: real Twitch image, role icon fallback, then the 7TV badge.
  await expect(lineA.locator('.cw-chat-badge')).toHaveCount(3);
  await expect(lineA.locator('img.cw-badge-twitch')).toHaveAttribute('src', /badges\/v1\/moderator\/1/);
  await expect(lineA.locator('svg.cw-badge-role')).toHaveAttribute('aria-label', 'Subscriber');
  await expect(lineA.locator('img.cw-badge-7tv')).toHaveAttribute('title', 'Minecraft Event Winner');

  // Paints arrive after the message.
  const nameA = lineA.locator('.cw-chat-name.cw-paint');
  await expect(nameA).toHaveCount(1);
  const styleA = await nameA.evaluate((el) => {
    const s = getComputedStyle(el);
    return { image: s.backgroundImage, filter: s.filter, clip: s.webkitBackgroundClip || s.backgroundClip, fill: s.webkitTextFillColor };
  });
  expect(styleA.image).toContain('cdn.7tv.app/paint/01JHXJFACX42RV996VE9933TB8');
  expect(styleA.filter).toContain('drop-shadow');
  expect(styleA.clip).toBe('text');
  expect(styleA.fill).toBe('rgba(0, 0, 0, 0)');
  const imageB = await lineB.locator('.cw-chat-name.cw-paint').evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(imageB).toContain('repeating-linear-gradient(66deg');

  // Live 7TV set update: a new emote works without a reload.
  await expect.poll(() => events?.subscribed.length ?? 0).toBeGreaterThanOrEqual(1);
  expect(events!.subscribed[0]).toEqual({ op: 35, d: { type: 'emote_set.update', condition: { object_id: '01FE9DRF000009TR6M9N941CYW' } } });
  events!.ws.send(
    JSON.stringify({
      op: 0,
      d: { type: 'emote_set.update', body: { id: '01FE9DRF000009TR6M9N941CYW', pushed: [{ key: 'emotes', index: 9, value: { id: '01NEWEMOTE', name: 'catJAM', flags: 0, data: { animated: true } } }] } }
    })
  );
  const c = chat('catJAM vibing', { user: { id: '5', login: 'm0ss', display_name: 'm0ss' } });
  sock.send({ type: 'event', event: c });
  await expect(layer(page, 'chat').locator(`[data-msg-id="${c.id}"] img.cw-emote-7tv[alt="catJAM"]`)).toHaveAttribute('src', 'https://cdn.7tv.app/emote/01NEWEMOTE/2x.webp');

  await page.waitForTimeout(300);
  await layer(page, 'chat').screenshot({ path: join(screens, 'chat-emotes.png') });
  expect(errors).toEqual([]);
});
