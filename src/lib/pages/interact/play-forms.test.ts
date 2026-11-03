import { describe, expect, it } from 'vitest';
import { pickWeighted } from '$lib/api/mock-play';
import {
  claimLeft,
  commandRest,
  defaultGiveawaySettings,
  defaultQueueSettings,
  giveawayIssues,
  historyCsv,
  howToEnter,
  keywordClash,
  queueIssues,
  sameWord
} from './play-forms';

describe('giveaway form', () => {
  it('needs a prize and a way to enter', () => {
    const s = defaultGiveawaySettings();
    expect(giveawayIssues(s).title).toBeTruthy();
    s.title = 'Mouse';
    expect(giveawayIssues(s)).toEqual({});
    s.keyword = '';
    expect(giveawayIssues(s).entry).toBeTruthy();
    s.reward_id = 'r1';
    expect(giveawayIssues(s)).toEqual({});
    s.keyword = 'two words';
    expect(giveawayIssues(s).keyword).toBeTruthy();
    s.keyword = '!join';
    s.rules.sub_entries = 0;
    expect(giveawayIssues(s).sub_entries).toBeTruthy();
    s.rules.sub_entries = 2;
    s.claim_s = 4000;
    expect(giveawayIssues(s).claim_s).toBeTruthy();
    expect(giveawayIssues({ ...s, claim_s: 60, title: 'x'.repeat(81) }).title).toBeTruthy();
  });

  it('says how to enter', () => {
    const s = { keyword: '!join', reward_id: 'r', reward_title: 'Ticket' };
    expect(howToEnter(s)).toBe('Type !join or redeem "Ticket" to enter.');
    expect(howToEnter({ ...s, reward_id: '' })).toBe('Type !join to enter.');
    expect(howToEnter({ ...s, keyword: ' ' })).toBe('Redeem "Ticket" to enter.');
  });

  it('counts down the claim time', () => {
    expect(claimLeft({ state: 'drawn', claim_until: 10_500 }, 0)).toBe(11);
    expect(claimLeft({ state: 'drawn', claim_until: 10_000 }, 20_000)).toBe(0);
    expect(claimLeft({ state: 'claimed', claim_until: 10_000 }, 0)).toBeNull();
    expect(claimLeft({ state: 'drawn', claim_until: null }, 0)).toBeNull();
  });

  it('exports history as safe CSV', () => {
    const csv = historyCsv([{ id: '1', title: '=HYPERLINK("x")', opened_at: Date.UTC(2026, 0, 2), ended_at: 0, entrants: 3, entries: 5, winners: ['a', 'b "c"'] }]);
    const [head, row] = csv.trim().split('\r\n');
    expect(head).toBe('"opened","ended","prize","people","entries","winners"');
    expect(row).toBe('"2026-01-02T00:00:00.000Z","","\'=HYPERLINK(""x"")","3","5","a, b ""c"""');
  });
});

describe('queue form', () => {
  it('needs different words and a sane party', () => {
    const s = defaultQueueSettings();
    expect(queueIssues(s)).toEqual({});
    expect(queueIssues({ ...s, leave_word: '!Join' }).words).toBeTruthy();
    expect(queueIssues({ ...s, join_word: '' }).join_word).toBeTruthy();
    expect(queueIssues({ ...s, position_word: '' })).toEqual({});
    expect(queueIssues({ ...s, party_size: 0 }).party_size).toBeTruthy();
    expect(queueIssues({ ...s, max_size: 5000 }).max_size).toBeTruthy();
  });

  it('matches command words like the backend', () => {
    expect(sameWord('!join', 'JOIN')).toBe(true);
    expect(sameWord('', '')).toBe(false);
    expect(commandRest('!join Kat#1', '!join')).toBe('Kat#1');
    expect(commandRest('join', '!join')).toBeNull();
    expect(commandRest('!joined', '!join')).toBeNull();
    expect(commandRest('enter now', 'enter')).toBe('now');
    expect(keywordClash('!join', '!JOIN', true)).toBe(true);
    expect(keywordClash('!join', '!join', false)).toBe(false);
    expect(keywordClash('!enter', '!join', true)).toBe(false);
  });
});

describe('demo draw', () => {
  it('picks by weight', () => {
    const seq = [0, 1, 2, 9];
    let i = 0;
    const rand = () => seq[i++]!;
    const w = [1, 2, 7];
    expect([pickWeighted(w, rand), pickWeighted(w, rand), pickWeighted(w, rand), pickWeighted(w, rand)]).toEqual([0, 1, 1, 2]);
    expect(pickWeighted([0, 0], rand)).toBeNull();
  });
});
