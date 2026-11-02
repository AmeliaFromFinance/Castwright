import { describe, expect, it } from 'vitest';
import type { MessagePart } from '$lib/bindings/MessagePart';
import { chatPieces, matchWord, srcset, type ChatPiece } from './tokenize';
import type { ThirdPartyEmote } from './types';

function emote(code: string, extra: Partial<ThirdPartyEmote> = {}): ThirdPartyEmote {
  return { provider: '7tv', id: `id-${code}`, code, width: 32, height: 32, images: [{ url: `https://x/${code}`, width: 32 }], zeroWidth: false, animated: false, ...extra };
}
const map = (...list: ThirdPartyEmote[]) => new Map(list.map((e) => [e.code, e]));
const text = (t: string): MessagePart => ({ type: 'text', text: t });

/** Short form: emotes as [code], stacks as [base+zw], other text as is. */
function show(pieces: ChatPiece[]): string {
  return pieces
    .map((p) => (p.type === 'emote' ? `[${[p.emote.code, ...p.overlays.map((o) => o.code)].join('+')}]` : p.type === 'text' ? p.text : `<${p.text}>`))
    .join('');
}

describe('matchWord', () => {
  const emotes = map(emote('KEKW'), emote('D:'), emote(':tf:'), emote('KEKW!'));
  it('matches whole words exactly and by case', () => {
    expect(matchWord('KEKW', emotes)?.emote.code).toBe('KEKW');
    expect(matchWord('kekw', emotes)).toBeNull();
    expect(matchWord('KEKWW', emotes)).toBeNull();
    expect(matchWord('aKEKW', emotes)).toBeNull();
  });
  it('trims punctuation, longest code first', () => {
    expect(matchWord('KEKW!!', emotes)).toEqual({ pre: '', emote: emotes.get('KEKW!'), post: '!' });
    expect(matchWord('KEKW,', emotes)).toEqual({ pre: '', emote: emotes.get('KEKW'), post: ',' });
    expect(matchWord('(:tf:)', emotes)).toEqual({ pre: '(', emote: emotes.get(':tf:'), post: ')' });
    expect(matchWord('D:', emotes)?.emote.code).toBe('D:');
    expect(matchWord('"D:"', emotes)).toEqual({ pre: '"', emote: emotes.get('D:'), post: '"' });
  });
});

describe('chatPieces', () => {
  const emotes = map(emote('KEKW'), emote('RainTime', { zeroWidth: true }), emote('Clap', { provider: 'bttv' }), emote('Kappa'));

  it('replaces words and keeps spacing', () => {
    expect(show(chatPieces([text('hi  KEKW there KEKW')], emotes))).toBe('hi  [KEKW] there [KEKW]');
    expect(show(chatPieces([text('KEKW, nice. Clap!')], emotes))).toBe('[KEKW], nice. [Clap]!');
  });
  it('leaves Twitch emotes, mentions and cheers alone', () => {
    const parts: MessagePart[] = [
      { type: 'emote', text: 'Kappa', id: '25' },
      text(' @KEKW '),
      { type: 'mention', text: '@KEKW', login: 'kekw' },
      text(' '),
      { type: 'cheermote', text: 'Cheer100', prefix: 'Cheer', bits: 100 }
    ];
    const out = chatPieces(parts, emotes);
    expect(out[0]).toMatchObject({ type: 'emote', emote: { provider: 'twitch', id: '25', code: 'Kappa' } });
    expect(show(out)).toBe('[Kappa] @[KEKW] <@KEKW> <Cheer100>');
  });
  it('stacks zero-width emotes on the emote before', () => {
    expect(show(chatPieces([text('KEKW RainTime ok')], emotes))).toBe('[KEKW+RainTime] ok');
    expect(show(chatPieces([text('KEKW RainTime RainTime')], emotes))).toBe('[KEKW+RainTime+RainTime]');
  });
  it('stacks over a Twitch emote too', () => {
    const out = chatPieces([{ type: 'emote', text: 'Kappa', id: '25' }, text(' RainTime')], emotes);
    expect(show(out)).toBe('[Kappa+RainTime]');
    expect(out[0]).toMatchObject({ emote: { provider: 'twitch' }, overlays: [{ code: 'RainTime', provider: '7tv' }] });
  });
  it('draws a zero-width emote alone when nothing is before it', () => {
    expect(show(chatPieces([text('RainTime KEKW')], emotes))).toBe('[RainTime] [KEKW]');
    expect(show(chatPieces([text('hey RainTime')], emotes))).toBe('hey [RainTime]');
  });
  it('is a no-op without emotes', () => {
    expect(chatPieces([text('KEKW')], new Map())).toEqual([{ type: 'text', text: 'KEKW' }]);
  });
});

describe('srcset', () => {
  it('uses width descriptors and sizes for the shown height', () => {
    const e = { width: 64, height: 32, images: [{ url: 'a', width: 64 }, { url: 'b', width: 128 }, { url: 'c', width: 256 }] };
    expect(srcset(e, 40)).toEqual({ srcset: 'a 64w, b 128w, c 256w', sizes: '80px', src: 'b' });
  });
});
