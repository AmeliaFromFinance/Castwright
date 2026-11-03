<script lang="ts">
  import type { SessionSummary } from '$lib/bindings/SessionSummary';
  import { count } from '$lib/format';
  import { BUCKET_MS, TIMELINE_GROUPS, bucketTimeline, type Bucket } from './summary';

  interface Props {
    summary: SessionSummary;
    dark: boolean;
  }
  let { summary, dark }: Props = $props();

  const EVENTS_H = 110;
  const CHAT_H = 36;
  const GAP = 26;
  const AXIS = 18;
  const H = EVENTS_H + GAP + CHAT_H + AXIS;

  let width = $state(600);
  let hover = $state<number | null>(null);

  const buckets = $derived(bucketTimeline(summary));
  const maxEvents = $derived(Math.max(1, ...buckets.map((b) => b.total)));
  const maxChat = $derived(Math.max(1, ...buckets.map((b) => b.chat)));
  const slot = $derived(width / buckets.length);
  const bw = $derived(Math.max(2, Math.min(26, slot - 2)));
  const color = (g: (typeof TIMELINE_GROUPS)[number]) => (dark ? g.dark : g.light);

  /** Bar with rounded top corners, or a plain rect for lower segments. */
  function bar(x: number, y: number, w: number, h: number, round: boolean): string {
    const r = round ? Math.min(4, w / 2, h) : 0;
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  function segments(b: Bucket, i: number) {
    const x = i * slot + (slot - bw) / 2;
    const parts = TIMELINE_GROUPS.filter((g) => b.counts[g.id] > 0);
    let y = EVENTS_H;
    return parts.map((g, k) => {
      const h = (b.counts[g.id] / maxEvents) * EVENTS_H;
      const top = k === parts.length - 1;
      // 2px gap between stacked segments.
      const d = bar(x, y - h, bw, Math.max(1, h - (top ? 0 : 2)), top);
      y -= h;
      return { id: g.id, d, fill: color(g) };
    });
  }

  function minuteLabel(i: number): string {
    const mins = (i * BUCKET_MS) / 60_000;
    return mins % 60 === 0 ? `${mins / 60}h` : `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
  }

  // Label every hour, or every 30 min on short streams.
  const labelEvery = $derived(buckets.length <= 9 ? 3 : 6);
  const clock = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
</script>

<div class="timeline">
  <div class="legend" aria-hidden="true">
    {#each TIMELINE_GROUPS as g (g.id)}
      <span><i style="background:{color(g)}"></i>{g.label}</span>
    {/each}
    <span><i class="chat"></i>Chat messages</span>
  </div>
  <div class="plot" bind:clientWidth={width}>
    <svg {width} height={H} role="img" aria-label="Events and chat per 10 minutes">
      <line class="base" x1="0" x2={width} y1={EVENTS_H + 0.5} y2={EVENTS_H + 0.5} />
      {#each buckets as b, i (b.start)}
        {#each segments(b, i) as seg (seg.id)}
          <path d={seg.d} fill={seg.fill} />
        {/each}
        {#if b.chat > 0}
          {@const h = Math.max(2, (b.chat / maxChat) * CHAT_H)}
          <path class="chatbar" d={bar(i * slot + (slot - bw) / 2, EVENTS_H + GAP + CHAT_H - h, bw, h, true)} />
        {/if}
        {#if i % labelEvery === 0}
          <text x={i * slot + 1} y={H - 4}>{minuteLabel(i)}</text>
        {/if}
        <rect
          class="hit"
          role="presentation"
          x={i * slot}
          y="0"
          width={slot}
          height={EVENTS_H + GAP + CHAT_H}
          onpointerenter={() => (hover = i)}
          onpointerleave={() => (hover = null)}
        />
      {/each}
      <line class="base" x1="0" x2={width} y1={EVENTS_H + GAP + CHAT_H + 0.5} y2={EVENTS_H + GAP + CHAT_H + 0.5} />
      {#if hover !== null}
        <rect class="hl" x={hover * slot} y="0" width={slot} height={EVENTS_H + GAP + CHAT_H} />
      {/if}
    </svg>
    {#if hover !== null}
      {@const b = buckets[hover]!}
      {@const right = (hover + 1) * slot + 8}
      <div class="tip" style="left:{right + 170 <= width ? right : Math.max(0, hover * slot - 178)}px">
        <div class="tt">{clock(b.start)} – {clock(b.start + BUCKET_MS)}</div>
        {#each TIMELINE_GROUPS as g (g.id)}
          {#if b.counts[g.id]}
            <div class="tr"><i style="background:{color(g)}"></i>{g.label}<span>{count(b.counts[g.id])}</span></div>
          {/if}
        {/each}
        <div class="tr"><i class="chat"></i>Chat<span>{count(b.chat)}</span></div>
      </div>
    {/if}
  </div>
  <table class="sr-only">
    <caption>Events and chat per 10 minutes</caption>
    <thead><tr><th>From</th>{#each TIMELINE_GROUPS as g (g.id)}<th>{g.label}</th>{/each}<th>Chat</th></tr></thead>
    <tbody>
      {#each buckets as b (b.start)}
        <tr><td>{clock(b.start)}</td>{#each TIMELINE_GROUPS as g (g.id)}<td>{b.counts[g.id]}</td>{/each}<td>{b.chat}</td></tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .timeline {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .legend span,
  .tr {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  i {
    width: 9px;
    height: 9px;
    border-radius: 3px;
    flex: none;
  }
  i.chat {
    background: var(--text-faint);
  }
  .plot {
    position: relative;
  }
  svg {
    display: block;
    overflow: visible;
  }
  .base {
    stroke: var(--border);
  }
  .chatbar {
    fill: var(--text-faint);
    opacity: 0.7;
  }
  text {
    font-size: 10.5px;
    fill: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .hit {
    fill: transparent;
  }
  .hl {
    fill: var(--text);
    opacity: 0.05;
    pointer-events: none;
  }
  .tip {
    position: absolute;
    top: 0;
    width: 170px;
    padding: 8px 10px;
    border-radius: var(--radius);
    background: var(--bg-1);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-pop);
    font-size: 12px;
    pointer-events: none;
    display: flex;
    flex-direction: column;
    gap: 3px;
    z-index: 2;
  }
  .tt {
    font-weight: 650;
    margin-bottom: 2px;
  }
  .tr span {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }
</style>
