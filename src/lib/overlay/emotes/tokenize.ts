import type { MessagePart } from '$lib/bindings/MessagePart';
import type { EmoteMap, Image, ThirdPartyEmote } from './types';

export interface ShownEmote {
  provider: 'twitch' | ThirdPartyEmote['provider'];
  id: string;
  code: string;
  /** Size at 1x, for the aspect ratio. */
  width: number;
  height: number;
  images: Image[];
}

export type ChatPiece =
  | { type: 'text'; text: string }
  | { type: 'mention'; text: string }
  | { type: 'cheer'; text: string }
  /** `overlays` are zero-width emotes stacked on top. */
  | { type: 'emote'; emote: ShownEmote; overlays: ShownEmote[] };

export function twitchEmote(id: string, code: string): ShownEmote {
  const base = `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/default/dark`;
  return {
    provider: 'twitch',
    id,
    code,
    width: 28,
    height: 28,
    images: [
      { url: `${base}/1.0`, width: 28 },
      { url: `${base}/2.0`, width: 56 },
      { url: `${base}/3.0`, width: 112 }
    ]
  };
}

function shown(e: ThirdPartyEmote): ShownEmote {
  return { provider: e.provider, id: e.id, code: e.code, width: e.width, height: e.height, images: e.images };
}

const EDGE = /[\p{P}\p{S}]/u;

/**
 * Finds an emote in one word. Tries the whole word first, then the longest
 * code left after trimming punctuation from either end ("KEKW!!" -> "KEKW").
 */
export function matchWord(word: string, emotes: EmoteMap): { pre: string; emote: ThirdPartyEmote; post: string } | null {
  const exact = emotes.get(word);
  if (exact) return { pre: '', emote: exact, post: '' };
  const chars = Array.from(word);
  let lead = 0;
  while (lead < chars.length && EDGE.test(chars[lead]!)) lead++;
  let trail = 0;
  while (trail < chars.length - lead && EDGE.test(chars[chars.length - 1 - trail]!)) trail++;
  if (lead === 0 && trail === 0) return null;
  const n = chars.length;
  for (let len = n - 1; len > 0; len--) {
    for (let i = Math.max(0, n - trail - len); i <= Math.min(lead, n - len); i++) {
      const j = i + len;
      if (j < n - trail) continue;
      const code = chars.slice(i, j).join('');
      const emote = emotes.get(code);
      if (emote) return { pre: chars.slice(0, i).join(''), emote, post: chars.slice(j).join('') };
    }
  }
  return null;
}

/** Message parts with 7TV, BetterTTV and FrankerFaceZ codes turned into emotes. */
export function chatPieces(parts: readonly MessagePart[], emotes: EmoteMap): ChatPiece[] {
  const out: ChatPiece[] = [];
  const text = (t: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last?.type === 'text') last.text += t;
    else out.push({ type: 'text', text: t });
  };
  const emote = (e: ThirdPartyEmote) => {
    if (e.zeroWidth) {
      // Stack on the emote just before, if only spaces sit between them.
      const last = out[out.length - 1];
      const prev = last?.type === 'text' && !last.text.trim() ? out[out.length - 2] : last;
      if (prev?.type === 'emote') {
        if (prev !== last) out.pop();
        prev.overlays.push(shown(e));
        return;
      }
    }
    out.push({ type: 'emote', emote: shown(e), overlays: [] });
  };

  for (const p of parts) {
    if (p.type === 'emote') out.push({ type: 'emote', emote: twitchEmote(p.id, p.text), overlays: [] });
    else if (p.type === 'mention') out.push({ type: 'mention', text: p.text });
    else if (p.type === 'cheermote') out.push({ type: 'cheer', text: p.text });
    else if (!emotes.size) text(p.text);
    else {
      for (const token of p.text.split(/(\s+)/)) {
        if (!token || /^\s+$/.test(token)) {
          text(token);
          continue;
        }
        const m = matchWord(token, emotes);
        if (!m) {
          text(token);
          continue;
        }
        text(m.pre);
        emote(m.emote);
        text(m.post);
      }
    }
  }
  return out;
}

/** `srcset` with width descriptors, plus the `sizes` that fits an emote shown `height` pixels tall. */
export function srcset(e: Pick<ShownEmote, 'images' | 'width' | 'height'>, height: number): { srcset: string; sizes: string; src: string } {
  const w = Math.max(1, Math.round((height * e.width) / Math.max(1, e.height)));
  return {
    srcset: e.images.map((i) => `${i.url} ${Math.round(i.width)}w`).join(', '),
    sizes: `${w}px`,
    src: e.images[Math.min(1, e.images.length - 1)]?.url ?? ''
  };
}
