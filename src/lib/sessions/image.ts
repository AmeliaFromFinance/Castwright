// Draws the summary card as a 1200 x 675 PNG for sharing.

import type { SessionSummary } from '$lib/bindings/SessionSummary';
import type { Ranked } from '$lib/bindings/Ranked';
import { count } from '$lib/format';
import { TIMELINE_GROUPS, bucketTimeline, durationText, totalSubs } from './summary';

const W = 1200;
const H = 675;
const PAD = 48;
const FONT = '"Inter Variable", Inter, system-ui, sans-serif';

interface Palette {
  bg: string;
  panel: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
}

const DARK: Palette = { bg: '#141518', panel: '#1d1f24', border: '#2c2f36', text: '#f0efec', muted: '#a5a8b0', accent: '#9db8ff' };
const LIGHT: Palette = { bg: '#fcfcfb', panel: '#f1f2f4', border: '#dcdee3', text: '#16171a', muted: '#5b5e66', accent: '#2a5bd7' };

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number | number[]) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export async function renderPng(s: SummaryInput): Promise<string> {
  if (typeof document !== 'undefined' && document.fonts) await document.fonts.ready.catch(() => undefined);
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available.');
  ctx.scale(scale, scale);
  draw(ctx, s);
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}

export interface SummaryInput {
  summary: SessionSummary;
  channel: string;
  dark: boolean;
}

function draw(ctx: CanvasRenderingContext2D, { summary: s, channel, dark }: SummaryInput) {
  const p = dark ? DARK : LIGHT;
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  // Heading
  const date = new Date(s.session.started_at).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  ctx.fillStyle = p.accent;
  ctx.font = `600 16px ${FONT}`;
  ctx.fillText(fit(ctx, [channel, date].filter(Boolean).join(' · '), W - PAD * 2), PAD, PAD + 14);
  ctx.fillStyle = p.text;
  ctx.font = `700 32px ${FONT}`;
  ctx.fillText(fit(ctx, s.session.title || 'Stream summary', W - PAD * 2), PAD, PAD + 56);
  ctx.fillStyle = p.muted;
  ctx.font = `500 17px ${FONT}`;
  ctx.fillText(fit(ctx, s.session.categories.join(' · ') || 'No category', W - PAD * 2), PAD, PAD + 86);

  // Headline numbers
  const tiles: Array<[string, string, string]> = [
    [durationText(s.duration_ms), 'Streamed', ''],
    [count(s.session.peak_viewers), 'Peak viewers', s.session.avg_viewers ? `${count(s.session.avg_viewers)} average` : ''],
    [count(s.follows), 'New follows', ''],
    [count(totalSubs(s)), 'Subs', s.gifted_subs ? `${count(s.gifted_subs)} gifted` : ''],
    [count(s.bits), 'Bits', ''],
    [count(s.chat_messages), 'Chat messages', `${count(s.chatters)} chatters`]
  ];
  const gap = 14;
  const top = PAD + 118;
  const tw = (W - PAD * 2 - gap * (tiles.length - 1)) / tiles.length;
  const th = 118;
  tiles.forEach(([value, label, sub], i) => {
    const x = PAD + i * (tw + gap);
    ctx.fillStyle = p.panel;
    roundRect(ctx, x, top, tw, th, 14);
    ctx.fill();
    ctx.fillStyle = p.text;
    ctx.font = `700 34px ${FONT}`;
    ctx.fillText(fit(ctx, value, tw - 32), x + 16, top + 50);
    ctx.fillStyle = p.muted;
    ctx.font = `600 14px ${FONT}`;
    ctx.fillText(fit(ctx, label, tw - 32), x + 16, top + 78);
    if (sub) {
      ctx.font = `500 13px ${FONT}`;
      ctx.fillText(fit(ctx, sub, tw - 32), x + 16, top + 99);
    }
  });

  // Top lists
  const listTop = top + th + 36;
  const lists: Array<[string, Ranked[], (n: number) => string]> = [
    ['Top chatters', s.top_chatters, (n) => count(n)],
    [s.top_cheerers.length || !s.top_gifters.length ? 'Top cheerers' : 'Top gifters', s.top_cheerers.length || !s.top_gifters.length ? s.top_cheerers : s.top_gifters, (n) => count(n)]
  ];
  const colW = 250;
  lists.forEach(([title, rows, fmt], i) => {
    const x = PAD + i * (colW + 28);
    ctx.fillStyle = p.muted;
    ctx.font = `700 13px ${FONT}`;
    ctx.fillText(title.toUpperCase(), x, listTop);
    const shown = rows.slice(0, 5);
    if (!shown.length) {
      ctx.font = `500 16px ${FONT}`;
      ctx.fillText('None this time', x, listTop + 32);
    }
    shown.forEach((r, j) => {
      const y = listTop + 34 + j * 36;
      ctx.fillStyle = p.text;
      ctx.font = `600 17px ${FONT}`;
      ctx.fillText(fit(ctx, r.name, colW - 70), x, y);
      ctx.fillStyle = p.muted;
      ctx.font = `500 16px ${FONT}`;
      const v = fmt(r.amount);
      ctx.fillText(v, x + colW - ctx.measureText(v).width, y);
    });
  });

  // Timeline
  const tx = PAD + 2 * (colW + 28) + 12;
  const tWidth = W - PAD - tx;
  ctx.fillStyle = p.muted;
  ctx.font = `700 13px ${FONT}`;
  ctx.fillText('EVENTS PER 10 MINUTES', tx, listTop);
  const buckets = bucketTimeline(s);
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const chartTop = listTop + 18;
  const chartH = 190;
  const slot = tWidth / buckets.length;
  const bw = Math.max(2, Math.min(28, slot - 2));
  buckets.forEach((b, i) => {
    let y = chartTop + chartH;
    const x = tx + i * slot + (slot - bw) / 2;
    const parts = TIMELINE_GROUPS.filter((g) => b.counts[g.id] > 0);
    parts.forEach((g, k) => {
      const h = (b.counts[g.id] / max) * chartH;
      const last = k === parts.length - 1;
      ctx.fillStyle = dark ? g.dark : g.light;
      roundRect(ctx, x, y - h, bw, Math.max(1, h - (last ? 0 : 2)), last ? [Math.min(4, bw / 2), Math.min(4, bw / 2), 0, 0] : 0);
      ctx.fill();
      y -= h;
    });
  });
  ctx.strokeStyle = p.border;
  ctx.beginPath();
  ctx.moveTo(tx, chartTop + chartH + 0.5);
  ctx.lineTo(tx + tWidth, chartTop + chartH + 0.5);
  ctx.stroke();
  // Legend
  let lx = tx;
  ctx.font = `500 13px ${FONT}`;
  for (const g of TIMELINE_GROUPS) {
    ctx.fillStyle = dark ? g.dark : g.light;
    roundRect(ctx, lx, chartTop + chartH + 16, 10, 10, 3);
    ctx.fill();
    ctx.fillStyle = p.muted;
    ctx.fillText(g.label, lx + 15, chartTop + chartH + 26);
    lx += 22 + ctx.measureText(g.label).width + 12;
  }

  // Footer
  const extras = [
    s.raids_in.length ? `${s.raids_in.length} raid${s.raids_in.length === 1 ? '' : 's'} in` : '',
    s.raids_out.length ? `raided ${s.raids_out.at(-1)!.name}` : '',
    s.first_chatters.length ? `${count(s.first_chatters.length)} first-time chatters` : '',
    s.donation_count ? `${count(s.donation_count)} donations` : ''
  ].filter(Boolean);
  ctx.fillStyle = p.muted;
  ctx.font = `500 15px ${FONT}`;
  ctx.fillText(fit(ctx, extras.join(' · '), W - PAD * 2 - 140), PAD, H - PAD + 10);
  ctx.font = `600 13px ${FONT}`;
  const brand = 'Castwright';
  ctx.fillText(brand, W - PAD - ctx.measureText(brand).width, H - PAD + 10);
}
