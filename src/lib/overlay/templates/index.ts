// Ready-made overlays for the New overlay dialog. Each JSON file lists layers with only
// the fields that differ from the defaults; `box` and `items` name a style preset.
import type { Animation } from '$lib/bindings/Animation';
import type { BoxStyle } from '$lib/bindings/BoxStyle';
import type { Layer } from '$lib/bindings/Layer';
import type { Overlay } from '$lib/bindings/Overlay';
import { baseLayer, defaultBoxStyle, kindDefaults, newId, type LayerType } from '$lib/editor/layers';
import { findPreset, presetBox, presetCard, presetText, type BoxPreset } from '../presets';
import brb from './brb.json';
import ending from './ending.json';
import gameplay from './gameplay.json';
import justChatting from './just-chatting.json';
import startingSoon from './starting-soon.json';
import vertical from './vertical.json';

type Obj = Record<string, unknown>;

export interface TemplateLayer extends Partial<Omit<Layer, 'kind' | 'box_style' | 'enter' | 'exit' | 'idle'>> {
  kind: { type: LayerType } & Obj;
  /** Style preset for the layer's box. */
  box?: string;
  /** Style preset for chat and event cards, and their text. */
  items?: string;
  box_style?: Partial<BoxStyle>;
  enter?: Partial<Animation>;
  exit?: Partial<Animation>;
  idle?: Partial<Animation>;
}

export interface TemplateFile {
  id: string;
  name: string;
  description: string;
  width: number;
  height: number;
  fonts?: string[];
  layers: TemplateLayer[];
}

export const TEMPLATE_FILES = [justChatting, gameplay, startingSoon, brb, ending, vertical] as unknown as readonly TemplateFile[];

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** `patch` over `base`, objects merged key by key, arrays replaced. */
export function merge<T>(base: T, patch: unknown): T {
  if (!isObj(base) || !isObj(patch)) return (patch === undefined ? base : patch) as T;
  const out: Obj = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = k in out ? merge(out[k], v) : v;
  return out as T;
}

function preset(id: string | undefined): BoxPreset | undefined {
  if (id === undefined) return undefined;
  const p = findPreset(id);
  if (!p) throw new Error(`Unknown style preset "${id}"`);
  return p;
}

export function buildLayer(t: TemplateLayer, id: string): Layer {
  const base = baseLayer();
  const { box, items, kind: k, box_style, enter, exit, idle, ...rest } = t;
  let kind = kindDefaults(k.type) as unknown as Obj;
  const p = preset(items);
  if (p && (k.type === 'chat' || k.type === 'event_list' || k.type === 'poll')) {
    const chat = k.type === 'chat';
    kind = {
      ...kind,
      style: presetText(kind.style as never, p.text),
      [chat ? 'bubble' : 'item_box']: presetBox(p, chat ? 'chat' : 'events'),
      item_card: presetCard(p)
    };
  }
  const b = preset(box);
  return {
    ...base,
    ...rest,
    id,
    kind: merge(kind, k) as unknown as Layer['kind'],
    box_style: merge(b ? presetBox(b, 'layer') : defaultBoxStyle(), box_style ?? {}),
    enter: { ...base.enter, ...enter },
    exit: { ...base.exit, ...exit },
    idle: { ...base.idle, ...idle }
  };
}

/** The template as an overlay. Ids are stable, so previews keep their scoped styles. */
export function buildTemplate(t: TemplateFile): Overlay {
  return {
    id: `tpl-${t.id}`,
    name: t.name,
    width: t.width,
    height: t.height,
    layers: t.layers.map((l, i) => buildLayer(l, `tpl-${t.id}-${i}`)),
    fonts: t.fonts ?? ['Inter'],
    updated_at: 0
  };
}

export interface OverlayTemplate {
  id: string;
  name: string;
  description: string;
  overlay: Overlay;
}

export const BUILT_IN_TEMPLATES: readonly OverlayTemplate[] = TEMPLATE_FILES.map((t) => ({
  id: t.id,
  name: t.name,
  description: t.description,
  overlay: buildTemplate(t)
}));

/** A new overlay from a template: a deep copy with fresh ids. */
export function fromTemplate(overlay: Overlay, name: string): Overlay {
  const o = JSON.parse(JSON.stringify(overlay)) as Overlay;
  o.id = newId();
  o.name = name.trim() || overlay.name;
  o.updated_at = 0;
  for (const l of o.layers) l.id = newId();
  return o;
}
