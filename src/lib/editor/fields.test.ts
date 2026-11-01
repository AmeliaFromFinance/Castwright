import { describe, expect, it } from 'vitest';
import { currentValue, fieldSpecs, fieldsText, groupSpecs, locateJsonError, parseFieldsJson } from './fields';

describe('parseFieldsJson', () => {
  it('treats an empty box as no fields', () => {
    expect(parseFieldsJson('  ')).toEqual({ ok: true, fields: {}, specs: [] });
  });

  it('builds specs for every StreamElements type', () => {
    const r = parseFieldsJson(
      JSON.stringify({
        title: { type: 'text', label: 'Title', value: 'Hi' },
        size: { type: 'number', label: 'Size', value: 20, min: 8, max: 72 },
        speed: { type: 'slider', label: 'Speed', value: 5, min: 1, max: 10, step: 0.5 },
        bold: { type: 'checkbox', label: 'Bold', value: true },
        color: { type: 'colorpicker', label: 'Colour', value: '#ff0000' },
        mode: { type: 'dropdown', label: 'Mode', value: 'a', options: { a: 'Option A', b: 'Option B' } },
        font: { type: 'googleFont', label: 'Font', value: 'Poppins' },
        pic: { type: 'image-input', label: 'Picture' },
        clip: { type: 'video-input' },
        ding: { type: 'sound-input', label: 'Sound' },
        secret: { type: 'hidden', value: 'x' },
        reset: { type: 'button', label: 'Reset' }
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.specs.map((s) => s.type)).toEqual([
      'text',
      'number',
      'slider',
      'checkbox',
      'colorpicker',
      'dropdown',
      'googleFont',
      'image-input',
      'video-input',
      'sound-input'
    ]);
    const by = Object.fromEntries(r.specs.map((s) => [s.key, s]));
    expect(by.size).toMatchObject({ min: 8, max: 72, value: 20 });
    expect(by.speed).toMatchObject({ min: 1, max: 10, step: 0.5 });
    expect(by.mode!.options).toEqual([
      { value: 'a', label: 'Option A' },
      { value: 'b', label: 'Option B' }
    ]);
    expect(by.clip!.label).toBe('clip');
    expect(by.secret).toBeUndefined();
    expect(by.reset).toBeUndefined();
    // The raw definitions are kept, hidden fields included.
    expect(Object.keys(r.fields)).toContain('secret');
  });

  it('gives sliders a usable range by default', () => {
    expect(fieldSpecs({ s: { type: 'slider' } })[0]).toMatchObject({ min: 0, max: 100, step: 1 });
  });

  it('accepts dropdown options as an array and numeric strings for limits', () => {
    const [s] = fieldSpecs({ d: { type: 'dropdown', options: ['x', { value: 'y', label: 'Why' }] }, n: { type: 'number', min: '2' } });
    expect(s!.options).toEqual([
      { value: 'x', label: 'x' },
      { value: 'y', label: 'Why' }
    ]);
    expect(fieldSpecs({ n: { type: 'number', min: '2' } })[0]!.min).toBe(2);
  });

  it('shows unknown types as text', () => {
    expect(fieldSpecs({ q: { type: 'fancy' } })[0]!.type).toBe('text');
  });

  it('reports invalid JSON with a line and column', () => {
    const r = parseFieldsJson('{\n  "a": { "type": "text" },\n  "b": oops\n}');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/^Line 3, column \d+: /);
    expect(r.error).toBe('Line 3, column 8: Expected a value (text in double quotes, a number, true, false, an object or a list)');
  });

  it('explains common mistakes', () => {
    expect(locateJsonError('{"a": 1,}')).toEqual({ line: 1, column: 9, message: 'Remove the comma before }' });
    expect(locateJsonError('{"a": 1\n "b": 2}').message).toMatch(/comma missing/);
    expect(locateJsonError("{'a': 1}").message).toMatch(/double quotes/);
    expect(locateJsonError('{"a": "x').message).toBe('Missing closing quote');
    expect(locateJsonError('{"a": 1').message).toMatch(/Expected , or }/);
    expect(locateJsonError('{} x').message).toBe('Unexpected text after the end');
  });

  it('rejects JSON that is not an object of objects', () => {
    const arr = parseFieldsJson('[1, 2]');
    expect(arr.ok).toBe(false);
    if (!arr.ok) expect(arr.error).toMatch(/JSON object/);
    const bad = parseFieldsJson('{"color": "red"}');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain('"color"');
    const badType = parseFieldsJson('{"color": {"type": 5}}');
    expect(badType.ok).toBe(false);
  });
});

describe('values and groups', () => {
  const specs = fieldSpecs({
    a: { type: 'text', value: 'default', group: 'Look' },
    b: { type: 'checkbox', value: false },
    c: { type: 'number', value: 1, group: 'Look' }
  });

  it('prefers saved values over defaults', () => {
    expect(currentValue(specs[0]!, {})).toBe('default');
    expect(currentValue(specs[0]!, { a: 'saved' })).toBe('saved');
    expect(currentValue(specs[1]!, { b: true })).toBe(true);
  });

  it('groups with ungrouped first', () => {
    expect(groupSpecs(specs).map((g) => [g.group, g.specs.map((s) => s.key)])).toEqual([
      ['', ['b']],
      ['Look', ['a', 'c']]
    ]);
  });

  it('formats definitions for the editor', () => {
    expect(fieldsText({})).toBe('');
    expect(fieldsText({ a: { type: 'text' } })).toBe('{\n  "a": {\n    "type": "text"\n  }\n}');
  });
});
