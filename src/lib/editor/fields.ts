// StreamElements "Fields" JSON for custom widgets: parsing and the settings form model.

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'slider'
  | 'checkbox'
  | 'colorpicker'
  | 'dropdown'
  | 'googleFont'
  | 'image-input'
  | 'video-input'
  | 'sound-input';

const KNOWN: ReadonlySet<string> = new Set<FieldType>([
  'text',
  'textarea',
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

/** Types that have no value to edit. */
const SKIPPED: ReadonlySet<string> = new Set(['hidden', 'button']);

export interface FieldSpec {
  key: string;
  type: FieldType;
  label: string;
  /** Default from the field definition. */
  value: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string; label: string }>;
  group?: string;
}

export type FieldsResult =
  | { ok: true; fields: Record<string, unknown>; specs: FieldSpec[] }
  | { ok: false; error: string };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

function options(raw: unknown): Array<{ value: string; label: string }> {
  if (Array.isArray(raw)) {
    return raw.map((o) =>
      isObj(o) ? { value: String(o.value ?? ''), label: String(o.label ?? o.value ?? '') } : { value: String(o), label: String(o) }
    );
  }
  if (isObj(raw)) return Object.entries(raw).map(([value, label]) => ({ value, label: String(label) }));
  return [];
}

/** Finds where and why JSON is invalid, with plain messages. Only used after JSON.parse fails. */
export function locateJsonError(text: string): { line: number; column: number; message: string } {
  let i = 0;
  const fail = (message: string): never => {
    throw { at: i, message };
  };
  const ws = () => {
    while (i < text.length && /\s/.test(text[i]!)) i++;
  };
  const str = () => {
    i++;
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\n') fail('Text in quotes can\'t span lines');
      i += text[i] === '\\' ? 2 : 1;
    }
    if (i >= text.length) fail('Missing closing quote');
    i++;
  };
  const value = (): void => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      ws();
      if (text[i] === '}') return void i++;
      for (;;) {
        ws();
        if (text[i] !== '"') fail(text[i] === '}' ? 'Remove the comma before }' : 'Expected a name in double quotes');
        str();
        ws();
        if (text[i] !== ':') fail('Expected : after the name');
        i++;
        value();
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === '}') return void i++;
        fail("Expected , or } (is a comma missing?)");
      }
    }
    if (c === '[') {
      i++;
      ws();
      if (text[i] === ']') return void i++;
      for (;;) {
        value();
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === ']') return void i++;
        fail('Expected , or ]');
      }
    }
    if (c === '"') return str();
    const m = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));
    if (m) {
      i += m[0].length;
      return;
    }
    fail(c === undefined ? 'The text ends too early' : c === "'" ? 'Use double quotes, not single quotes' : 'Expected a value (text in double quotes, a number, true, false, an object or a list)');
  };
  let at = text.length;
  let message = 'Invalid JSON';
  try {
    value();
    ws();
    if (i < text.length) fail('Unexpected text after the end');
  } catch (e) {
    const err = e as { at: number; message: string };
    at = err.at;
    message = err.message;
  }
  const before = text.slice(0, at);
  const line = before.split('\n').length;
  return { line, column: at - before.lastIndexOf('\n'), message };
}

/** Form fields for a definition object, in the order they were written. */
export function fieldSpecs(fields: Record<string, unknown>): FieldSpec[] {
  const out: FieldSpec[] = [];
  for (const [key, def] of Object.entries(fields ?? {})) {
    if (!isObj(def)) continue;
    const type = typeof def.type === 'string' ? def.type : 'text';
    if (SKIPPED.has(type)) continue;
    const spec: FieldSpec = {
      key,
      type: (KNOWN.has(type) ? type : 'text') as FieldType,
      label: typeof def.label === 'string' && def.label.trim() ? def.label : key,
      value: def.value
    };
    if (typeof def.group === 'string') spec.group = def.group;
    const min = num(def.min);
    const max = num(def.max);
    const step = num(def.step);
    if (min !== undefined) spec.min = min;
    if (max !== undefined) spec.max = max;
    if (step !== undefined) spec.step = step;
    if (spec.type === 'slider') {
      spec.min ??= 0;
      spec.max ??= 100;
      spec.step ??= 1;
    }
    if (spec.type === 'dropdown') spec.options = options(def.options);
    out.push(spec);
  }
  return out;
}

/** Parses the Fields tab. An empty box means no fields. */
export function parseFieldsJson(text: string): FieldsResult {
  if (!text.trim()) return { ok: true, fields: {}, specs: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    const at = locateJsonError(text);
    return { ok: false, error: `Line ${at.line}, column ${at.column}: ${at.message}` };
  }
  if (!isObj(raw)) {
    return { ok: false, error: 'Fields must be a JSON object, like { "color": { "type": "colorpicker", "value": "#ffffff" } }.' };
  }
  for (const [key, def] of Object.entries(raw)) {
    if (!isObj(def)) return { ok: false, error: `"${key}" must be an object with a "type", like { "type": "text" }.` };
    if (def.type !== undefined && typeof def.type !== 'string') return { ok: false, error: `"${key}": "type" must be text.` };
  }
  return { ok: true, fields: raw, specs: fieldSpecs(raw) };
}

/** The value a field currently has: the saved one, or its default. */
export function currentValue(spec: FieldSpec, values: Record<string, unknown>): unknown {
  return Object.prototype.hasOwnProperty.call(values ?? {}, spec.key) ? values[spec.key] : spec.value;
}

/** Groups in first-seen order; fields without a group come first. */
export function groupSpecs(specs: readonly FieldSpec[]): Array<{ group: string; specs: FieldSpec[] }> {
  const map = new Map<string, FieldSpec[]>();
  for (const s of specs) {
    const g = s.group ?? '';
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(s);
  }
  const out = [...map.entries()].map(([group, specs]) => ({ group, specs }));
  return out.sort((a, b) => (a.group === '' ? -1 : b.group === '' ? 1 : 0));
}

/** Pretty JSON for the Fields tab. */
export function fieldsText(fields: Record<string, unknown>): string {
  return Object.keys(fields ?? {}).length ? JSON.stringify(fields, null, 2) : '';
}
