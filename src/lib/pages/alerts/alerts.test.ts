import { describe, expect, it } from 'vitest';
import starter from '$lib/api/fixtures/starter-project.json';
import type { AlertConfig } from '$lib/bindings/AlertConfig';
import type { Project } from '$lib/bindings/Project';
import { ALERT_KINDS } from '$lib/format';
import {
  alertContext,
  alertsLayerSize,
  buildPlay,
  containsBlocked,
  defaultVariation,
  duplicateVariation,
  fieldsFor,
  hideLinks,
  newAlertType,
  nextVariationName,
  parseWordList,
  pickVariation,
  previewOverlay,
  renderPlay,
  sampleEvent,
  tokensFor
} from './alerts';

const project = starter as unknown as Project;
const config = (): AlertConfig => JSON.parse(JSON.stringify(project.alerts)) as AlertConfig;

describe('defaults', () => {
  it('match the Rust Variation default', () => {
    const v = defaultVariation();
    const starterDefault = project.alerts.types.find((t) => t.kind === 'follow')!.variations[0]!;
    const { id: _a, title: _b, message: _c, ...rest } = v;
    const { id: _d, title: _e, message: _f, ...expected } = starterDefault;
    expect(rest).toEqual(expected);
    expect(v.id).toMatch(/^[a-z0-9]{12}$/);
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
  });

  it('new types have one enabled variation', () => {
    for (const k of ALERT_KINDS) {
      const t = newAlertType(k);
      expect(t.enabled).toBe(true);
      expect(t.variations).toHaveLength(1);
      expect(t.variations[0]!.title).not.toBe('');
    }
  });

  it('duplicates get a fresh id and a free name', () => {
    const v = defaultVariation({ name: 'Big' });
    const d = duplicateVariation(v, ['Big', 'Big copy']);
    expect(d.id).not.toBe(v.id);
    expect(d.name).toBe('Big copy 2');
    expect(d.conditions).not.toBe(v.conditions);
    expect(nextVariationName(['Default', 'Variation 2'])).toBe('Variation 3');
  });
});

describe('suggestions', () => {
  it('every alert kind has fields and tokens', () => {
    for (const k of ALERT_KINDS) {
      expect(fieldsFor(k).length).toBeGreaterThan(0);
      expect(tokensFor(k).length).toBeGreaterThan(0);
    }
    expect(fieldsFor('sub').map((f) => f.value)).toContain('tier');
    expect(fieldsFor('redemption').map((f) => f.value)).toContain('data.reward_title');
  });

  it('sample events match the kind', () => {
    for (const k of ALERT_KINDS) expect(sampleEvent(k).kind).toBe(k);
    expect(sampleEvent('redemption').data.reward_title).toBe('Hydrate');
  });
});

describe('selection and rendering', () => {
  it('first enabled match wins', () => {
    const c = config();
    const sub = c.types.find((t) => t.kind === 'sub')!;
    const e = sampleEvent('sub');
    e.tier = 3;
    expect(pickVariation(sub, e)?.name).toBe('Tier 3');
    expect(buildPlay(c, e)?.title).toBe('quietfox is a legend!');
    e.tier = 1;
    const p = buildPlay(c, e)!;
    expect(p.title).toBe('quietfox subscribed!');
    expect(p.message).toBe('Tier 1');
    sub.variations[1]!.enabled = false;
    expect(buildPlay(c, e)).toBeNull();
    sub.enabled = false;
    e.tier = 3;
    expect(buildPlay(c, e)).toBeNull();
  });

  it('applies the filters', () => {
    const c = config();
    c.settings.min_bits = 1000;
    expect(buildPlay(c, sampleEvent('cheer'))).toBeNull();
    c.settings.min_raid_viewers = 300;
    expect(buildPlay(c, sampleEvent('raid'))).toBeNull();
    const gift = sampleEvent('gift_sub');
    gift.data = { community_gift_id: 'x' };
    expect(buildPlay(c, gift)).toBeNull();
    c.settings.combine_gifts = false;
    expect(buildPlay(c, gift)).not.toBeNull();
    expect(buildPlay(c, sampleEvent('community_gift'))).toBeNull();
  });

  it('cleans viewer messages', () => {
    const s = config().settings;
    const v = defaultVariation({ title: '{{name}}', message: '{{message}}', tts: true });
    const e = sampleEvent('cheer');
    e.message = 'see example.com and (https://x.io)!';
    expect(renderPlay(v, e, { ...s, hide_links: true }).message).toBe('see [link] and [link]');
    const blocked = renderPlay(v, e, { ...s, hide_links: false, blocked_words: [' EXAMPLE '] });
    expect(blocked.message).toBe('');
    expect(blocked.tts).toBe(false);
  });

  it('clamps duration and volume', () => {
    const v = defaultVariation({ duration_ms: 10, volume: 250 });
    const p = renderPlay(v, sampleEvent('follow'), config().settings, 'fixed');
    expect(p.id).toBe('fixed');
    expect(p.duration_ms).toBe(500);
    expect(p.volume).toBe(100);
  });

  it('context has name, recipient_name and kind', () => {
    const ctx = alertContext(sampleEvent('gift_sub'));
    expect(ctx.name).toBe('quietfox');
    expect(ctx.recipient_name).toBe('LumenLark');
    const anon = sampleEvent('gift_sub');
    anon.user = null;
    anon.is_anonymous = true;
    expect(alertContext(anon).name).toBe('Anonymous');
  });
});

describe('helpers', () => {
  it('link detection matches the backend', () => {
    expect(hideLinks('hi www.a.b ok')).toBe('hi [link] ok');
    expect(hideLinks('3.14 is pi')).toBe('3.14 is pi');
    expect(hideLinks('end. new')).toBe('end. new');
    expect(hideLinks('foo.bar/baz')).toBe('[link]');
    expect(containsBlocked('Hello', ['', ' '])).toBe(false);
  });

  it('parses word lists', () => {
    expect(parseWordList(' a, b ,, c ')).toEqual(['a', 'b', 'c']);
  });

  it('preview overlay has one alerts layer filling it', () => {
    const o = previewOverlay(640, 300);
    expect(o.layers).toHaveLength(1);
    expect(o.layers[0]!.kind.type).toBe('alerts');
    expect([o.layers[0]!.w, o.layers[0]!.h]).toEqual([640, 300]);
    expect(alertsLayerSize(project.overlays)).toEqual({ width: 800, height: 420 });
    expect(alertsLayerSize([])).toEqual({ width: 800, height: 420 });
  });
});

import { sampleFor } from './alerts';

describe('sampleFor', () => {
  it('adjusts the sample to match simple conditions', () => {
    const v = defaultVariation({
      conditions: {
        mode: 'all',
        conditions: [
          { field: 'tier', op: 'eq', value: 3 },
          { field: 'months', op: 'gt', value: 12 },
          { field: 'data.is_prime', op: 'is_true', value: null }
        ]
      }
    });
    const e = sampleFor('sub', v);
    expect(e.tier).toBe(3);
    expect(e.months).toBe(13);
    expect(e.data.is_prime).toBe(true);
  });

  it('falls back to the plain sample', () => {
    expect(sampleFor('sub', null)).toEqual(sampleEvent('sub'));
    const v = defaultVariation({ conditions: { mode: 'all', conditions: [{ field: 'name', op: 'eq', value: 'nobody' }] } });
    expect(sampleFor('sub', v)).toEqual(sampleEvent('sub'));
  });
});
