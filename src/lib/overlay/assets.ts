const PASS_THROUGH = /^(https?:|data:|blob:)/i;

/**
 * Turns a project asset path (`assets/logo.png` or `logo.png`) into a URL on the
 * Castwright server. Web, data and blob URLs are returned unchanged.
 */
export function resolveAsset(path: string, httpBase: string, token: string): string {
  const p = (path ?? '').trim();
  if (!p) return '';
  if (PASS_THROUGH.test(p)) return p;
  if (p.startsWith('//')) return `${httpBase.startsWith('https:') ? 'https:' : 'http:'}${p}`;
  const name = p.replace(/^\/+/, '').replace(/^assets\//, '');
  if (!name) return '';
  const base = httpBase.replace(/\/+$/, '');
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${base}/assets/${encodeURIComponent(name)}${query}`;
}

export function assetResolver(httpBase: string, token: string): (path: string) => string {
  return (path) => resolveAsset(path, httpBase, token);
}
