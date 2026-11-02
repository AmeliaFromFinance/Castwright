// Stand-ins for 7TV, BetterTTV and FrankerFaceZ so browser tests never reach the network.
import type { Page, WebSocketRoute } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../src/lib/overlay/emotes/fixtures');

export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtures, `${name}.json`), 'utf8'));
}

export interface ProviderData {
  seventvGlobal?: unknown;
  seventvUser?: unknown;
  bttvGlobal?: unknown;
  bttvUser?: unknown;
  ffzGlobal?: unknown;
  ffzRoom?: unknown;
  /** 7TV paint and badge ids per Twitch user id. */
  styles?: Record<string, { paint?: string; badge?: string }>;
  /** Raw 7TV paints and badges, as in the `7tv-cosmetics` fixture. */
  cosmetics?: unknown;
  /** The page's 7TV EventAPI connection, once it subscribes. */
  onEvents?: (ws: WebSocketRoute, subscribed: unknown[]) => void;
}

/** Small coloured squares, so emotes and badges are visible in screenshots. */
function square(url: string): string {
  const hue = [...url].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="6" fill="hsl(${hue},70%,60%)"/></svg>`;
}

export async function stubProviders(page: Page, data: ProviderData = {}): Promise<void> {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  const cosmetics = new Map<string, unknown>();
  const raw = (data.cosmetics as { data?: Record<string, Record<string, { id?: string }>> } | undefined)?.data ?? {};
  for (const v of Object.values(raw)) {
    const item = v.paint ?? v.badge;
    if (item?.id) cosmetics.set(item.id, item);
  }

  await page.route('https://7tv.io/**', (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path === '/v3/emote-sets/global') return r.fulfill(json(data.seventvGlobal ?? { id: 'global', emotes: [] }));
    if (path.startsWith('/v3/users/twitch/')) return r.fulfill(json(data.seventvUser ?? { emote_set: null, user: null }));
    if (path === '/v4/gql') {
      const query = String((r.request().postDataJSON() as { query?: string })?.query ?? '');
      const out: Record<string, unknown> = {};
      const users: Record<string, unknown> = {};
      for (const [, n, id] of query.matchAll(/u(\d+): userByConnection\(platform: TWITCH, platformId: "([^"]+)"\)/g)) {
        const s = data.styles?.[id!];
        users[`u${n}`] = s ? { style: { activePaintId: s.paint ?? null, activeBadgeId: s.badge ?? null } } : null;
      }
      if (Object.keys(users).length) out.users = users;
      for (const [, n, id] of query.matchAll(/p(\d+): paints \{ paint\(id: "([^"]+)"\)/g)) out[`p${n}`] = { paint: cosmetics.get(id!) ?? null };
      for (const [, n, id] of query.matchAll(/b(\d+): badges \{ badge\(id: "([^"]+)"\)/g)) out[`b${n}`] = { badge: cosmetics.get(id!) ?? null };
      return r.fulfill(json({ data: out }));
    }
    return r.fulfill(json({}));
  });
  await page.route('https://api.betterttv.net/**', (r) =>
    r.fulfill(json(r.request().url().includes('/users/') ? (data.bttvUser ?? { channelEmotes: [], sharedEmotes: [] }) : (data.bttvGlobal ?? [])))
  );
  await page.route('https://api.frankerfacez.com/**', (r) =>
    r.fulfill(json(r.request().url().includes('/room/') ? (data.ffzRoom ?? { sets: {} }) : (data.ffzGlobal ?? { default_sets: [], sets: {} })))
  );
  await page.route(/^https:\/\/cdn\.(7tv\.app|betterttv\.net|frankerfacez\.com)\//, (r) =>
    r.fulfill({ status: 200, contentType: 'image/svg+xml', body: square(r.request().url()) })
  );
  await page.route('https://static-cdn.jtvnw.net/badges/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: square(r.request().url()) }));
  await page.routeWebSocket(/^wss:\/\/events\.7tv\.io\//, (ws) => {
    const subscribed: unknown[] = [];
    ws.onMessage((m) => {
      subscribed.push(JSON.parse(String(m)));
      if (subscribed.length === 1) data.onEvents?.(ws, subscribed);
    });
    ws.send(JSON.stringify({ op: 1, d: { heartbeat_interval: 45_000, session_id: 'test' } }));
  });
}
