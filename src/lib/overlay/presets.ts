// Ready-made box styles. The data lives in box-presets.json so the backend tests can check it too.
import type { BoxStyle } from '$lib/bindings/BoxStyle';
import type { ItemCard } from '$lib/bindings/ItemCard';
import type { TextStyle } from '$lib/bindings/TextStyle';
import data from './box-presets.json';
import { DEFAULT_BOX, DEFAULT_ITEM_CARD, DEFAULT_TEXT } from './styles';

export interface BoxPreset {
  id: string;
  name: string;
  description: string;
  /** The look for layer boxes; `item` and `alert` adjust it for those. */
  box: Partial<BoxStyle>;
  item?: Partial<BoxStyle>;
  alert?: Partial<BoxStyle>;
  card?: Partial<ItemCard>;
  /** Chat and event text. */
  text?: Partial<TextStyle>;
  title?: Partial<TextStyle>;
  message?: Partial<TextStyle>;
  accent?: string;
}

/** Where a preset is used. */
export type PresetTarget = 'layer' | 'chat' | 'events' | 'alert';

export const BOX_PRESETS = data as unknown as readonly BoxPreset[];

export function findPreset(id: string): BoxPreset | undefined {
  return BOX_PRESETS.find((p) => p.id === id);
}

/** A complete BoxStyle for the target, starting from defaults so nothing from an older look is left over. */
export function presetBox(p: BoxPreset, target: PresetTarget): BoxStyle {
  const extra = target === 'alert' ? p.alert : target === 'layer' ? undefined : p.item;
  return structuredClone({ ...DEFAULT_BOX, ...p.box, ...(extra ?? {}) }) as BoxStyle;
}

export function presetCard(p: BoxPreset): ItemCard {
  return { ...DEFAULT_ITEM_CARD, ...(p.card ?? {}) };
}

/** Text settings a preset owns. Size, line height and alignment always stay the user's. */
const LOOK = ['font_weight', 'color', 'uppercase', 'italic', 'letter_spacing', 'stroke_width', 'stroke_color', 'shadow'] as const;

const PRESET_FONTS = new Set(BOX_PRESETS.flatMap((p) => [p.text, p.title, p.message].map((t) => t?.font_family ?? '')));

/** True when the font came from a preset or the default, so another preset may swap it. */
function presetFont(font: string | undefined): boolean {
  return !font || font === DEFAULT_TEXT.font_family || PRESET_FONTS.has(font);
}

/**
 * The preset's look on top of `base`. Anything the preset leaves out goes back to the
 * default, so picking presets in any order gives the same result as picking the last one.
 * A font the user picked themselves is kept.
 */
export function presetText(base: TextStyle, patch: Partial<TextStyle> | undefined): TextStyle {
  const out = { ...base };
  if (!patch) return out;
  const looks = out as Record<(typeof LOOK)[number], unknown>;
  for (const k of LOOK) looks[k] = patch[k] ?? DEFAULT_TEXT[k];
  if (presetFont(base.font_family)) out.font_family = patch.font_family ?? DEFAULT_TEXT.font_family;
  return out;
}
