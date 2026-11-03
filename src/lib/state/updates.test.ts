import { describe, expect, it } from 'vitest';
import { newerVersion } from './updates.svelte';

describe('newerVersion', () => {
  it('compares numerically', () => {
    expect(newerVersion('0.2.0', '0.1.9')).toBe(true);
    expect(newerVersion('v1.2.10', '1.2.9')).toBe(true);
    expect(newerVersion('1.2.9', '1.2.10')).toBe(false);
    expect(newerVersion('1.0', '1.0.0')).toBe(false);
    expect(newerVersion('1.0.0-beta', '1.0.0')).toBe(false);
    expect(newerVersion('0.10.0', '0.9.9')).toBe(true);
    expect(newerVersion('0.6.0', '0.6.0')).toBe(false);
    expect(newerVersion('0.5.1', '0.6.0')).toBe(false);
  });
});
