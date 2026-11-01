// Sample alerts, events and chat for testing an overlay in the editor.
import samples from '$lib/api/fixtures/sample-events.json';
import type { AlertConfig } from '$lib/bindings/AlertConfig';
import type { AlertPlay } from '$lib/bindings/AlertPlay';
import type { Event } from '$lib/bindings/Event';
import type { EventKind } from '$lib/bindings/EventKind';
import { render } from '$lib/logic/template';
import { eventContext } from '$lib/overlay/labels';
import { newId } from './layers';

const SAMPLES = samples as unknown as Event[];

const NAMES = ['nova_kat', 'pixelbyte', 'LumenLark', 'quietfox', 'kettle_drum', 'm0ss'];
const LINES = ['this overlay looks so clean', 'hello from the test chat!', 'gg', 'love the colours', 'hype!!'];

let n = 0;

/** A fresh copy of the sample event of `kind`, with a new id and the current time. */
export function sampleEvent(kind: EventKind, now = Date.now()): Event {
  const base = SAMPLES.find((e) => e.kind === kind) ?? SAMPLES[0]!;
  const e = structuredClone(base);
  e.id = `test-${newId()}`;
  e.ts = now;
  e.test = true;
  return e;
}

export function sampleChat(text?: string, now = Date.now()): Event {
  const i = n++;
  const name = NAMES[i % NAMES.length]!;
  const message = text ?? LINES[i % LINES.length]!;
  const e = sampleEvent('chat', now);
  e.user = { id: `test-${i % NAMES.length}`, login: name.toLowerCase(), display_name: name };
  e.message = message;
  e.message_parts = [{ type: 'text', text: message }];
  return e;
}

/** Alert kinds with at least one enabled variation. */
export function testableKinds(config: AlertConfig | null | undefined): EventKind[] {
  return (config?.types ?? []).filter((t) => t.enabled && t.variations.some((v) => v.enabled)).map((t) => t.kind);
}

/** What the backend would send to overlays for this event, using the first enabled variation. */
export function sampleAlert(
  config: AlertConfig | null | undefined,
  kind: EventKind,
  event: Event = sampleEvent(kind),
  vars: Record<string, unknown> = {}
): AlertPlay | null {
  const type = config?.types.find((t) => t.kind === kind && t.enabled);
  const v = type?.variations.find((x) => x.enabled);
  if (!v) return null;
  const ctx = { ...vars, ...eventContext(event) };
  return {
    id: `test-${newId()}`,
    kind,
    event,
    variation_id: v.id,
    priority: v.priority,
    title: render(v.title, ctx),
    message: render(v.message, ctx),
    image: v.image,
    video: v.video,
    sound: v.sound,
    volume: v.volume,
    duration_ms: v.duration_ms,
    enter: v.enter,
    exit: v.exit,
    layout: v.layout,
    title_style: v.title_style,
    message_style: v.message_style,
    accent: v.accent,
    background: v.background,
    tts: v.tts
  };
}
