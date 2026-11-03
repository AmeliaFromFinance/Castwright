import { describe, expect, it } from 'vitest';
import type { Event } from '$lib/bindings/Event';
import { duration, needsNewSignIn, newPoll, newPrediction, newReward, pollIssues, predictionIssues, redemptionFromEvent, rewardIssues } from './forms';

describe('reward form', () => {
  it('needs a title and a cost', () => {
    const r = newReward();
    expect(rewardIssues(r).title).toBeTruthy();
    expect(rewardIssues({ ...r, title: 'Hydrate' })).toEqual({});
    expect(rewardIssues({ ...r, title: 'Hydrate', cost: 0 }).cost).toBeTruthy();
    expect(rewardIssues({ ...r, title: 'x'.repeat(46) }).title).toContain('45');
    expect(rewardIssues({ ...r, title: 'A', color: 'red' }).color).toBeTruthy();
  });

  it('catches duplicate titles but not the reward itself', () => {
    const a = { ...newReward(), id: 'a', title: 'Hydrate' };
    expect(rewardIssues({ ...newReward(), title: 'hydrate ' }, [a]).title).toContain('already');
    expect(rewardIssues(a, [a])).toEqual({});
  });
});

describe('poll and prediction forms', () => {
  it('checks the question, options and length', () => {
    const p = { ...newPoll(), title: 'Next map?', choices: ['Dust', 'Mirage'] };
    expect(pollIssues(p)).toEqual({});
    expect(pollIssues({ ...p, choices: ['Dust'] }).options).toBe('Use 2 to 5 choices.');
    expect(pollIssues({ ...p, choices: ['Dust', ' '] })['option.1']).toBeTruthy();
    expect(pollIssues({ ...p, duration_s: 5 }).duration_s).toBeTruthy();
    expect(pollIssues(newPoll()).title).toBeTruthy();

    const q = { ...newPrediction(), title: 'Win?', outcomes: ['Yes', 'No'] };
    expect(predictionIssues(q)).toEqual({});
    expect(predictionIssues({ ...q, outcomes: Array(11).fill('x') }).options).toBe('Use 2 to 10 outcomes.');
    expect(predictionIssues({ ...q, window_s: 10 }).window_s).toBeTruthy();
  });
});

describe('helpers', () => {
  it('spots sign-ins from before these features', () => {
    const acc = { id: '1', login: 'a', display_name: 'a', profile_image_url: '', scopes: ['bits:read'] };
    expect(needsNewSignIn(acc)).toBe(true);
    expect(needsNewSignIn({ ...acc, scopes: [] })).toBe(false);
    expect(needsNewSignIn(null)).toBe(false);
  });

  it('turns a redemption event into a queue entry', () => {
    const e = {
      id: 'e1',
      kind: 'redemption',
      ts: 5,
      user: { id: '9', login: 'nova', display_name: 'Nova' },
      amount: 300,
      message: 'hi',
      data: { redemption_id: 'r-1', reward_id: 'rw', reward_title: 'Song', status: 'unfulfilled' },
      test: false
    } as unknown as Event;
    expect(redemptionFromEvent(e)).toMatchObject({ id: 'r-1', reward_id: 'rw', cost: 300, input: 'hi' });
    expect(redemptionFromEvent({ ...e, data: { ...e.data, status: 'fulfilled' } })).toBeNull();
    expect(redemptionFromEvent({ ...e, test: true })).toBeNull();
  });

  it('formats cooldowns', () => {
    expect(duration(0)).toBe('Off');
    expect(duration(45)).toBe('45 s');
    expect(duration(5400)).toBe('1 h 30 min');
  });
});
