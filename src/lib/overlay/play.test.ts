import { describe, expect, it } from 'vitest';
import { twitchBadges } from './chat';
import {
  drawFromVar,
  easeOut,
  giveawayFromVars,
  giveawayVisible,
  queueFromVars,
  queueVisible,
  reelOffset,
  sampleGiveaway,
  sampleQueue,
  spinMs,
  spinPhase,
  viewerEvent
} from './play';

const winner = { id: '7', login: 'kat', name: 'Kat', color: '#ff0000', badges: ['subscriber'], badge_images: [], roles: { subscriber: true } };

describe('giveaway layer', () => {
  it('reads the giveaway variables', () => {
    const v = giveawayFromVars({
      'giveaway.status': 'closed',
      'giveaway.title': 'Mouse',
      'giveaway.entries': 12,
      'giveaway.keyword': '!join',
      'giveaway.draw': { seq: 2, at: 1000, names: ['a', 'b', 'Kat'], winner }
    });
    expect(v.status).toBe('closed');
    expect(v.entries).toBe(12);
    expect(v.draw?.seq).toBe(2);
    expect(v.draw?.winner.roles).toEqual({ broadcaster: false, moderator: false, vip: false, subscriber: true });
  });

  it('is idle and empty without variables', () => {
    const v = giveawayFromVars({});
    expect(v).toEqual({ status: 'idle', title: '', entries: 0, keyword: '', draw: null });
    expect(giveawayVisible(v, true)).toBe(false);
    expect(giveawayVisible(v, false)).toBe(true);
    expect(giveawayVisible({ ...v, status: 'open' }, true)).toBe(true);
    expect(giveawayFromVars({ 'giveaway.status': 'idle', 'giveaway.draw': { winner } }).draw).toBeNull();
  });

  it('keeps the winner last in the spin', () => {
    expect(drawFromVar({ names: ['a', 'b'], winner })?.names).toEqual(['a', 'b', 'Kat']);
    expect(drawFromVar({ names: [], winner })?.names).toEqual(['Kat']);
    expect(drawFromVar({ names: ['a'] })).toBeNull();
    expect(drawFromVar(null)).toBeNull();
  });

  it('spins for the set time, then lands', () => {
    const draw = drawFromVar({ at: 10_000, names: ['a', 'Kat'], winner })!;
    const ms = spinMs(6);
    expect(ms).toBe(6000);
    expect(spinMs(0)).toBe(1000);
    expect(spinMs(99)).toBe(30_000);
    expect(spinPhase(draw, 10_000, ms)).toBe('spinning');
    expect(spinPhase(draw, 15_999, ms)).toBe('spinning');
    expect(spinPhase(draw, 16_000, ms)).toBe('landed');
    expect(spinPhase(draw, 0, ms)).toBe('landed');
  });

  it('slows down onto the last name', () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(2)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
    expect(reelOffset(10, 0, 6000)).toBe(0);
    expect(reelOffset(10, 6000, 6000)).toBe(9);
    expect(reelOffset(1, 3000, 6000)).toBe(0);
  });

  it('gives the winner badges like a chat message', () => {
    const e = viewerEvent({ ...drawFromVar({ winner })!.winner });
    expect(e.user?.display_name).toBe('Kat');
    expect(twitchBadges(e)).toEqual([{ kind: 'role', role: 'subscriber' }]);
  });

  it('has a sample for the editor that can spin', () => {
    const landed = sampleGiveaway(100_000);
    expect(spinPhase(landed.draw!, 100_000, 6000)).toBe('landed');
    const spinning = sampleGiveaway(100_000, 99_000);
    expect(spinPhase(spinning.draw!, 100_000, 6000)).toBe('spinning');
    expect(spinning.draw!.names.at(-1)).toBe(spinning.draw!.winner.name);
  });
});

describe('queue layer', () => {
  it('reads the queue variables', () => {
    const v = queueFromVars({
      'queue.open': true,
      'queue.size': 2,
      'queue.party': [{ id: '1', name: 'A', note: 'A#1' }],
      'queue.lineup': [{ id: '2', name: 'B', sub: true, position: 1 }, { nope: true }]
    });
    expect(v.open).toBe(true);
    expect(v.playing[0]).toMatchObject({ name: 'A', note: 'A#1', position: null });
    expect(v.lineup).toHaveLength(1);
    expect(v.lineup[0]).toMatchObject({ name: 'B', sub: true, position: 1 });
  });

  it('hides when empty if asked', () => {
    const empty = queueFromVars({});
    expect(queueVisible(empty, true, true, 5)).toBe(false);
    expect(queueVisible(empty, false, true, 5)).toBe(true);
    const s = sampleQueue();
    expect(queueVisible(s, true, true, 5)).toBe(true);
    expect(queueVisible({ ...s, playing: [] }, true, true, 0)).toBe(false);
    expect(queueVisible({ ...s, lineup: [] }, true, false, 5)).toBe(false);
  });
});
