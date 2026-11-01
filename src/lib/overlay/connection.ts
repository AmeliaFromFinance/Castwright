export interface Endpoint {
  overlayId: string;
  token: string;
  /** e.g. `http://127.0.0.1:7474`, no trailing slash. */
  httpBase: string;
  wsUrl: string;
}

type Loc = Pick<Location, 'protocol' | 'host' | 'pathname' | 'search'>;

/** Reads overlay id, token and server from `/overlay/<id>?token=` or the dev query params. */
export function parseLocation(loc: Loc): Endpoint {
  const q = new URLSearchParams(loc.search);
  const m = /\/overlay\/([^/?#]+)/.exec(loc.pathname);
  let overlayId = q.get('overlay') ?? '';
  if (!overlayId && m?.[1]) {
    try {
      overlayId = decodeURIComponent(m[1]);
    } catch {
      overlayId = m[1];
    }
  }
  const token = q.get('token') ?? '';
  const server = (q.get('server') ?? '').trim();
  let httpBase: string;
  if (server) {
    httpBase = /^https?:\/\//i.test(server) ? server : `http://${server}`;
  } else {
    httpBase = `${loc.protocol === 'https:' ? 'https:' : 'http:'}//${loc.host}`;
  }
  httpBase = httpBase.replace(/\/+$/, '');
  const wsBase = httpBase.replace(/^http/i, 'ws');
  const wsUrl = `${wsBase}/ws?token=${encodeURIComponent(token)}&overlay=${encodeURIComponent(overlayId)}`;
  return { overlayId, token, httpBase, wsUrl };
}

const BACKOFF_MS = [500, 1000, 2000, 5000];

/** Delay before reconnect attempt `n` (0-based): 0.5s, 1s, 2s, then 5s forever. */
export function backoffDelay(attempt: number): number {
  const i = Math.max(0, Math.floor(attempt));
  return BACKOFF_MS[Math.min(i, BACKOFF_MS.length - 1)] ?? 5000;
}
