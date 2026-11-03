import { describe, expect, it } from 'vitest';
import type { Soundboard } from '$lib/bindings/Soundboard';
import { cooldownLeft, defaultSoundboard, matchesSearch, moveButton, newButton, pageLabel, pages, playProgress, removePage, renamePage, visibleButtons } from './board';

const b = (id: string, label: string, group = '', extra: Partial<ReturnType<typeof newButton>> = {}) => newButton({ id, label, group, src: `assets/${id}.wav`, ...extra });

const board = (): Soundboard => ({
  ...defaultSoundboard(),
  groups: ['Memes', 'Music'],
  buttons: [
    b('horn', 'Airhorn', '', { emoji: '📯' }),
    b('sad', 'Sad trombone', 'Memes', { aliases: ['womp'] }),
    b('drum', 'Drum roll'),
    b('bruh', 'Bruh', 'Memes'),
    b('lost', 'Lost page', 'Gone')
  ]
});

describe('pages', () => {
  it('starts with the first page, then the board pages', () => {
    expect(pages(board())).toEqual(['', 'Memes', 'Music']);
    expect(pageLabel('')).toBe('Main');
    expect(pageLabel('Memes')).toBe('Memes');
  });

  it('shows a page in grid order; unknown pages land on the first page', () => {
    expect(visibleButtons(board(), '').map((x) => x.id)).toEqual(['horn', 'drum', 'lost']);
    expect(visibleButtons(board(), 'Memes').map((x) => x.id)).toEqual(['sad', 'bruh']);
    expect(visibleButtons(board(), 'Music')).toEqual([]);
  });

  it('renames and removes pages with their buttons', () => {
    const renamed = renamePage(board(), 'Memes', 'Funny');
    expect(renamed.groups).toEqual(['Funny', 'Music']);
    expect(visibleButtons(renamed, 'Funny').map((x) => x.id)).toEqual(['sad', 'bruh']);
    expect(renamePage(board(), 'Memes', 'Music')).toEqual(board());
    const removed = removePage(board(), 'Memes');
    expect(removed.groups).toEqual(['Music']);
    expect(visibleButtons(removed, '').map((x) => x.id)).toEqual(['horn', 'sad', 'drum', 'bruh', 'lost']);
  });
});

describe('search', () => {
  it('matches labels, aliases, file names and emoji across pages', () => {
    expect(visibleButtons(board(), 'Music', 'trom').map((x) => x.id)).toEqual(['sad']);
    expect(visibleButtons(board(), '', 'WOMP').map((x) => x.id)).toEqual(['sad']);
    expect(visibleButtons(board(), '', 'roll drum').map((x) => x.id)).toEqual(['drum']);
    expect(visibleButtons(board(), '', '📯').map((x) => x.id)).toEqual(['horn']);
    expect(visibleButtons(board(), '', 'bruh.wav').map((x) => x.id)).toEqual(['bruh']);
    expect(visibleButtons(board(), '', 'kazoo')).toEqual([]);
    expect(matchesSearch(board().buttons[0]!, '   ')).toBe(true);
  });
});

describe('ordering', () => {
  const ids = (list: { id: string }[]) => list.map((x) => x.id);

  it('drops a button where another one is', () => {
    const list = board().buttons;
    expect(ids(moveButton(list, 'horn', 'drum'))).toEqual(['sad', 'drum', 'horn', 'bruh', 'lost']);
    expect(ids(moveButton(list, 'bruh', 'horn'))).toEqual(['bruh', 'horn', 'sad', 'drum', 'lost']);
    expect(ids(moveButton(list, 'horn', 'horn'))).toEqual(ids(list));
    expect(ids(moveButton(list, 'nope', 'horn'))).toEqual(ids(list));
  });

  it('keeps page order after moving between pages', () => {
    const moved = moveButton(board().buttons, 'drum', 'horn');
    expect(ids(visibleButtons({ ...board(), buttons: moved }, ''))).toEqual(['drum', 'horn', 'lost']);
  });
});

describe('timing', () => {
  const status = { muted: false, cooldowns: { horn: 10_000 }, global_until: 0, stream_pages: 1 };

  it('counts down the longer of the sound and global cooldowns', () => {
    expect(cooldownLeft(status, 'horn', 4_000)).toBe(6);
    expect(cooldownLeft(status, 'horn', 9_001)).toBe(1);
    expect(cooldownLeft(status, 'horn', 10_000)).toBe(0);
    expect(cooldownLeft(status, 'drum', 0)).toBe(0);
    expect(cooldownLeft({ ...status, global_until: 15_000 }, 'drum', 5_000)).toBe(10);
    expect(cooldownLeft(null, 'horn', 0)).toBe(0);
  });

  it('shows how far a sound has played', () => {
    expect(playProgress(1_000, 2_000, 2_000)).toBe(0.5);
    expect(playProgress(1_000, 2_000, 9_000)).toBe(1);
    expect(playProgress(1_000, null, 2_000)).toBeNull();
    expect(playProgress(1_000, 0, 2_000)).toBeNull();
  });
});
