import { describe, expect, it } from 'vitest';
import { crc32, zipFiles } from './zip';

/** Reads a zip made by `zipFiles` back (stored entries only). */
function read(bytes: Uint8Array): Record<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    const start = local + 30 + view.getUint16(local + 26, true);
    const data = bytes.subarray(start, start + size);
    expect(view.getUint32(at + 16, true)).toBe(crc32(data));
    out[name] = dec.decode(data);
    at += 46 + nameLen;
  }
  return out;
}

describe('zip', () => {
  it('computes CRC-32', () => {
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('writes files that read back', () => {
    const zip = zipFiles([
      { name: 'README.txt', data: 'hi\n' },
      { name: 'app.json', data: '{"ok":true}' },
      { name: 'ünïcode.txt', data: new Uint8Array([104, 105]) }
    ]);
    expect(String.fromCharCode(zip[0]!, zip[1]!)).toBe('PK');
    expect(read(zip)).toEqual({ 'README.txt': 'hi\n', 'app.json': '{"ok":true}', 'ünïcode.txt': 'hi' });
    expect(read(zipFiles([]))).toEqual({});
  });
});
