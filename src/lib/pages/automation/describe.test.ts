import { describe, expect, it } from 'vitest';
import type { Step } from '$lib/bindings/Step';
import { fromTemplate, newAction, newTrigger } from './defaults';
import { commandPreview, describeTrigger, describeTriggers, every, fieldsForAction, tokensForAction } from './describe';

describe('describe', () => {
  it('formats intervals', () => {
    expect(every(45)).toBe('45 s');
    expect(every(600)).toBe('10 min');
    expect(every(90)).toBe('1 min 30 s');
    expect(every(7200)).toBe('2 h');
  });

  it('summarises triggers', () => {
    expect(describeTrigger({ type: 'command', name: '!so', aliases: [], permission: 'everyone', user_cooldown_s: 0 })).toBe('!so');
    expect(describeTrigger(newTrigger('command'))).toBe('Chat command');
    expect(describeTrigger({ type: 'event', kind: 'raid', conditions: { mode: 'all', conditions: [] } })).toBe('Raid');
    expect(describeTrigger({ type: 'timer', interval_s: 2700, only_when_live: true, min_chat_lines: 0 })).toBe('Every 45 min');
    expect(describeTrigger(newTrigger('scene_changed'))).toBe('Any scene change');
    expect(describeTrigger(newTrigger('manual'))).toBe('Button or Stream Deck');
    expect(describeTriggers(newAction())).toBe('No trigger');
  });

  it('previews commands from the arguments used', () => {
    const so: Step[] = [{ type: 'shoutout', user: '{{arg1}}', message: '' }];
    expect(commandPreview('so', so)).toBe('!so @user');
    expect(commandPreview('!add', [{ type: 'chat_send', message: '{{arg1}} + {{ arg2 }}', as_bot: false, reply: false }])).toBe('!add <arg1> <arg2>');
    expect(commandPreview('say', [{ type: 'log', message: '{{input}}' }])).toBe('!say <text>');
    expect(commandPreview('', [])).toBe('!command');
    const nested: Step[] = [{ type: 'if', conditions: { mode: 'all', conditions: [{ field: 'arg1', op: 'exists', value: null }] }, then: [], else: [] }];
    expect(commandPreview('x', nested)).toBe('!x <arg1>');
  });

  it('offers tokens from the triggers', () => {
    const cmd = tokensForAction(fromTemplate('command')).map((t) => t.token);
    expect(cmd).toContain('arg1');
    const raid = tokensForAction(fromTemplate('raid')).map((t) => t.token);
    expect(raid).toContain('name');
    expect(raid).not.toContain('arg1');
    const fields = fieldsForAction(fromTemplate('deaths'), { 'counter.deaths': 3 }).map((f) => f.value);
    expect(fields).toContain('arg_count');
    expect(fields).toContain('counter.deaths');
  });
});
