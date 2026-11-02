// Ready-made box styles. The data lives in box-presets.json so the backend tests can check it too.
import type { BoxStyle } from '$lib/bindings/BoxStyle';
import type { ItemCard } from '$lib/bindings/ItemCard';
import type { TextStyle } from '$lib/bindings/TextStyle';
import data from './box-presets.json';
import { DEFAULT_BOX, DEFAULT_ITEM_CARD } from './styles';

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

/** Keeps the size and alignment the user picked unless the preset needs its own. */
export function presetText(base: TextStyle, patch: Partial<TextStyle> | undefined): TextStyle {
  return { ...base, ...(patch ?? {}) };
}
