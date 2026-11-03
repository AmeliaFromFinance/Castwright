const PASS_THROUGH = /^(https?:|data:|blob:)/i;
/** Song covers the server keeps in memory. */
const MUSIC_ART = /^\/music\/art\/\d+$/;

/**
 * Turns a project asset path (`assets/logo.png` or `logo.png`) into a URL on the
 * Castwright server. Web, data and blob URLs are returned unchanged.
 */
export function resolveAsset(path: string, httpBase: string, token: string, assetKey = ''): string {
  const p = (path ?? '').trim();
  if (!p) return '';
  if (PASS_THROUGH.test(p)) return p;
  if (p.startsWith('//')) return `${httpBase.startsWith('https:') ? 'https:' : 'http:'}${p}`;
  const base = httpBase.replace(/\/+$/, '');
  // The asset key only opens /assets/ and covers, so widgets that see these links can't use the token.
  const query = assetKey
    ? `?key=${encodeURIComponent(assetKey)}`
    : token
      ? `?token=${encodeURIComponent(token)}`
      : '';
  if (MUSIC_ART.test(p)) return `${base}${p}${query}`;
  const name = p.replace(/^\/+/, '').replace(/^assets\//, '');
  if (!name) return '';
  return `${base}/assets/${encodeURIComponent(name)}${query}`;
}

export function assetResolver(httpBase: string, token: string, assetKey = ''): (path: string) => string {
  return (path) => resolveAsset(path, httpBase, token, assetKey);
}
