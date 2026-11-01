import { describe, expect, it } from 'vitest';
import { resolveAsset } from './assets';
import { backoffDelay, parseLocation } from './connection';

const BASE = 'http://127.0.0.1:7474';

describe('resolveAsset', () => {
  it('maps project paths to the server with the token', () => {
    expect(resolveAsset('assets/logo.png', BASE, 'abc')).toBe(`${BASE}/assets/logo.png?token=abc`);
    expect(resolveAsset('logo.png', BASE, 'abc')).toBe(`${BASE}/assets/logo.png?token=abc`);
    expect(resolveAsset('/assets/logo.png', BASE + '/', 'abc')).toBe(`${BASE}/assets/logo.png?token=abc`);
  });
  it('encodes names and tokens', () => {
    expect(resolveAsset('assets/my sound #1?.mp3', BASE, 'a&b=c')).toBe(
      `${BASE}/assets/my%20sound%20%231%3F.mp3?token=a%26b%3Dc`
    );
    expect(resolveAsset('assets/ünï.png', BASE, 't')).toBe(`${BASE}/assets/%C3%BCn%C3%AF.png?token=t`);
    expect(resolveAsset('assets/sub/x.png', BASE, 't')).toBe(`${BASE}/assets/sub%2Fx.png?token=t`);
  });
  it('passes web, data and blob URLs through', () => {
    for (const u of ['https://cdn.example.com/a.gif', 'HTTP://x.y/z.png', 'data:image/png;base64,AAAA', 'blob:http://x/1']) {
      expect(resolveAsset(u, BASE, 't')).toBe(u);
    }
  });
  it('returns nothing for empty paths', () => {
    expect(resolveAsset('', BASE, 't')).toBe('');
    expect(resolveAsset('   ', BASE, 't')).toBe('');
    expect(resolveAsset('assets/', BASE, 't')).toBe('');
  });
  it('omits the query without a token', () => {
    expect(resolveAsset('a.png', BASE, '')).toBe(`${BASE}/assets/a.png`);
  });
});

describe('parseLocation', () => {
  it('reads the server URL form', () => {
    const e = parseLocation({ protocol: 'http:', host: '127.0.0.1:7474', pathname: '/overlay/ov%201', search: '?token=t0k' });
    expect(e).toEqual({
      overlayId: 'ov 1',
      token: 't0k',
      httpBase: 'http://127.0.0.1:7474',
      wsUrl: 'ws://127.0.0.1:7474/ws?token=t0k&overlay=ov%201'
    });
  });
  it('reads the dev form with a server param', () => {
    const e = parseLocation({
      protocol: 'http:',
      host: 'localhost:1420',
      pathname: '/overlay.html',
      search: '?overlay=abc&token=x&server=127.0.0.1:7475'
    });
    expect(e.overlayId).toBe('abc');
    expect(e.httpBase).toBe('http://127.0.0.1:7475');
    expect(e.wsUrl).toBe('ws://127.0.0.1:7475/ws?token=x&overlay=abc');
  });
  it('uses wss for https', () => {
    const e = parseLocation({ protocol: 'https:', host: 'cw.example', pathname: '/overlay/a', search: '' });
    expect(e.wsUrl).toBe('wss://cw.example/ws?token=&overlay=a');
    expect(parseLocation({ protocol: 'http:', host: 'h', pathname: '/', search: '?server=https://x:1/' }).httpBase).toBe('https://x:1');
  });
});

describe('backoffDelay', () => {
  it('follows 0.5s, 1s, 2s then 5s forever', () => {
    expect([0, 1, 2, 3, 4, 10, 1000].map(backoffDelay)).toEqual([500, 1000, 2000, 5000, 5000, 5000, 5000]);
    expect(backoffDelay(-3)).toBe(500);
  });
});
