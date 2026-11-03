// Soundboard pages, search, ordering and timing. Same defaults as model/soundboard.rs.
import type { SoundButton } from '$lib/bindings/SoundButton';
import type { Soundboard } from '$lib/bindings/Soundboard';
import type { SoundboardStatus } from '$lib/bindings/SoundboardStatus';
import { newId } from '$lib/editors/ids';

/** Name shown for buttons with no page. */
export const FIRST_PAGE = 'Main';

export function defaultSoundboard(): Soundboard {
  return {
    buttons: [],
    groups: [],
    muted: false,
    global_cooldown_s: 0,
    request_reward_id: '',
    request_reward_title: '',
    command: { enabled: false, name: 'sound', permission: 'subscriber', cooldown_s: 30 }
  };
}

export function newButton(patch: Partial<SoundButton> = {}): SoundButton {
  return {
    id: newId(),
    label: 'New sound',
    src: '',
    emoji: '',
    color: '',
    volume: 80,
    cooldown_s: 0,
    output: 'stream',
    group: '',
    reward_id: '',
    reward_title: '',
    aliases: [],
    ...patch
  };
}

/** Page names: the first page, then the board's own pages. */
export function pages(board: Pick<Soundboard, 'groups'>): string[] {
  return ['', ...board.groups.filter((g) => g.trim())];
}

export const pageLabel = (g: string) => g || FIRST_PAGE;

/** Lowercase words, without punctuation or emoji, for loose matching. */
export function normalize(s: string): string {
  return (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(' ');
}

export function matchesSearch(b: SoundButton, query: string): boolean {
  if (!query.trim()) return true;
  const q = normalize(query);
  if (!q) return !!b.emoji && query.includes(b.emoji);
  const hay = [b.label, ...b.aliases, b.src.split('/').pop() ?? ''].map(normalize).join(' | ');
  return q.split(' ').every((w) => hay.includes(w)) || (!!b.emoji && query.includes(b.emoji));
}

/** Buttons to show: the page in grid order, or matches from every page while searching. */
export function visibleButtons(board: Pick<Soundboard, 'buttons' | 'groups'>, page: string, query = ''): SoundButton[] {
  if (query.trim()) return board.buttons.filter((b) => matchesSearch(b, query));
  const known = new Set(pages(board));
  return board.buttons.filter((b) => (known.has(b.group) ? b.group : '') === page);
}

/** Move `id` to where `targetId` is. Moving right lands after it, moving left before it. */
export function moveButton(buttons: readonly SoundButton[], id: string, targetId: string): SoundButton[] {
  const from = buttons.findIndex((b) => b.id === id);
  const to = buttons.findIndex((b) => b.id === targetId);
  if (from < 0 || to < 0 || from === to) return [...buttons];
  const out = [...buttons];
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved!);
  return out;
}

/** Rename a page, moving its buttons along. */
export function renamePage(board: Soundboard, from: string, to: string): Soundboard {
  const name = to.trim();
  if (!from || !name || from === name || board.groups.includes(name)) return board;
  return {
    ...board,
    groups: board.groups.map((g) => (g === from ? name : g)),
    buttons: board.buttons.map((b) => (b.group === from ? { ...b, group: name } : b))
  };
}

/** Remove a page; its buttons go to the first page. */
export function removePage(board: Soundboard, name: string): Soundboard {
  return {
    ...board,
    groups: board.groups.filter((g) => g !== name),
    buttons: board.buttons.map((b) => (b.group === name ? { ...b, group: '' } : b))
  };
}

/** Whole seconds until the button can play again, counting the global cooldown. */
export function cooldownLeft(status: SoundboardStatus | null, id: string, now: number): number {
  if (!status) return 0;
  const until = Math.max(status.cooldowns[id] ?? 0, status.global_until);
  return until > now ? Math.ceil((until - now) / 1000) : 0;
}

/** 0 to 1, or null when the length isn't known yet. */
export function playProgress(startedAt: number, durationMs: number | null, now: number): number | null {
  if (!durationMs || !(durationMs > 0)) return null;
  return Math.min(1, Math.max(0, (now - startedAt) / durationMs));
}

export const OUTPUT_LABELS: Record<SoundButton['output'], string> = {
  stream: 'On stream',
  local: 'Only me',
  both: 'Both'
};
