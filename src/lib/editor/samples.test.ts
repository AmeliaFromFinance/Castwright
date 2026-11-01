import { describe, expect, it } from 'vitest';
import starter from '$lib/api/fixtures/starter-project.json';
import type { Project } from '$lib/bindings/Project';
import { sampleAlert, sampleChat, sampleEvent, testableKinds } from './samples';

const project = structuredClone(starter as unknown as Project);

describe('samples', () => {
  it('copies sample events with new ids', () => {
    const a = sampleEvent('sub', 1000);
    const b = sampleEvent('sub', 1000);
    expect(a.kind).toBe('sub');
    expect(a.id).not.toBe(b.id);
    expect(a.ts).toBe(1000);
    expect(a.test).toBe(true);
  });

  it('makes chat messages with text parts', () => {
    const c = sampleChat('hello');
    expect(c.kind).toBe('chat');
    expect(c.message).toBe('hello');
    expect(c.message_parts).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('lists kinds that have an enabled variation', () => {
    expect(testableKinds(project.alerts)).toContain('follow');
    const off = structuredClone(project.alerts);
    off.types.forEach((t) => (t.enabled = false));
    expect(testableKinds(off)).toEqual([]);
    expect(testableKinds(null)).toEqual([]);
  });

  it('renders the first enabled variation for an alert', () => {
    const e = sampleEvent('follow');
    const play = sampleAlert(project.alerts, 'follow', e);
    expect(play).not.toBeNull();
    const v = project.alerts.types.find((t) => t.kind === 'follow')!.variations[0]!;
    expect(play!.variation_id).toBe(v.id);
    expect(play!.title).toBe(`${e.user!.display_name} followed`);
    expect(play!.title).not.toContain('{{');
    expect(play!.duration_ms).toBe(v.duration_ms);
  });

  it('skips disabled variations and kinds', () => {
    const cfg = structuredClone(project.alerts);
    const sub = cfg.types.find((t) => t.kind === 'sub')!;
    sub.variations[0]!.enabled = false;
    expect(sampleAlert(cfg, 'sub')!.variation_id).toBe(sub.variations[1]!.id);
    sub.enabled = false;
    expect(sampleAlert(cfg, 'sub')).toBeNull();
  });
});
