const PASS_THROUGH = /^(https?:|data:|blob:)/i;

/**
 * Turns a project asset path (`assets/logo.png` or `logo.png`) into a URL on the
 * Castwright server. Web, data and blob URLs are returned unchanged.
 */
export function resolveAsset(path: string, httpBase: string, token: string, assetKey = ''): string {
  const p = (path ?? '').trim();
  if (!p) return '';
  if (PASS_THROUGH.test(p)) return p;
  if (p.startsWith('//')) return `${httpBase.startsWith('https:') ? 'https:' : 'http:'}${p}`;
  const name = p.replace(/^\/+/, '').replace(/^assets\//, '');
  if (!name) return '';
  const base = httpBase.replace(/\/+$/, '');
  // The asset key only opens /assets/, so widgets that see these links can't use the token.
  const query = assetKey
    ? `?key=${encodeURIComponent(assetKey)}`
    : token
      ? `?token=${encodeURIComponent(token)}`
      : '';
  return `${base}/assets/${encodeURIComponent(name)}${query}`;
}

export function assetResolver(httpBase: string, token: string, assetKey = ''): (path: string) => string {
  return (path) => resolveAsset(path, httpBase, token, assetKey);
}
