// Sticky note text: **bold**, *italics* or _italics_, [links](https://…), and - or 1. lists.
// Everything else is plain text, escaped.

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(text: string): string {
  let out = '';
  const re = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|(?<![\w])_([^_\n]+)_(?![\w])/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    out += escape(text.slice(at, m.index));
    if (m[1] !== undefined) out += `<a href="${escape(m[2]!)}" target="_blank" rel="noopener noreferrer">${inline(m[1])}</a>`;
    else if (m[3] !== undefined) out += `<strong>${inline(m[3])}</strong>`;
    else out += `<em>${inline((m[4] ?? m[5])!)}</em>`;
    at = m.index! + m[0].length;
  }
  return out + escape(text.slice(at));
}

/** Note text as safe HTML. */
export function renderNote(text: string): string {
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      flushPara();
      const kind = bullet ? 'ul' : 'ol';
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline(item[1]!)}</li>`);
    } else if (!line.trim()) {
      flushPara();
      closeList();
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara();
  closeList();
  return out.join('');
}
