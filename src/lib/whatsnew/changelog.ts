// Reads CHANGELOG.md: "## 1.2.0 (date)" starts a version, "### New" a group,
// "- text" an item.

export interface Group {
  title: string;
  items: string[];
}

export interface Release {
  version: string;
  /** Text after the version, without brackets, like "2026-11-03" or "upcoming". */
  note: string;
  groups: Group[];
}

export type Inline = { type: 'text' | 'bold' | 'code'; text: string } | { type: 'link'; text: string; href: string };

const VERSION_HEAD = /^##\s+v?(\d+\.\d+\.\d+)\s*(.*)$/;

/** Every version in the changelog, newest first as written. */
export function parseChangelog(md: string): Release[] {
  const out: Release[] = [];
  let cur: Release | null = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const head = VERSION_HEAD.exec(line);
    if (head) {
      cur = { version: head[1]!, note: head[2]!.replace(/^[(–-]\s*|\s*\)$/g, '').trim(), groups: [] };
      out.push(cur);
    } else if (/^##\s/.test(line)) {
      cur = null;
    } else if (cur) {
      addLine(cur, line);
    }
  }
  return out;
}

/** One version's notes without the "## version" line, e.g. a GitHub release body. */
export function parseNotes(md: string, version = ''): Release {
  const r: Release = { version, note: '', groups: [] };
  for (const raw of md.split(/\r?\n/)) addLine(r, raw.trimEnd());
  return r;
}

function addLine(r: Release, line: string) {
  const group = /^###\s+(.+)$/.exec(line);
  if (group) {
    r.groups.push({ title: group[1]!.trim(), items: [] });
    return;
  }
  const item = /^[-*]\s+(.+)$/.exec(line);
  if (item) {
    if (!r.groups.length) r.groups.push({ title: '', items: [] });
    r.groups.at(-1)!.items.push(item[1]!.trim());
  } else if (/^\s{2,}\S/.test(line) && r.groups.at(-1)?.items.length) {
    // Wrapped item text.
    const items = r.groups.at(-1)!.items;
    items[items.length - 1] += ` ${line.trim()}`;
  }
}

export function findRelease(list: Release[], version: string): Release | undefined {
  const v = version.replace(/^v/, '').split('-')[0];
  return list.find((r) => r.version === v);
}

/** "0.6.0" → "0.6"; "1.2.3" stays. */
export function shortVersion(v: string): string {
  return v.replace(/^v/, '').replace(/\.0$/, '');
}

/** **bold**, `code` and [links](https://…). Everything else is plain text. */
export function inline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ type: 'bold', text: m[1] });
    else if (m[2] !== undefined) out.push({ type: 'code', text: m[2] });
    else out.push({ type: 'link', text: m[3]!, href: m[4]! });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}
