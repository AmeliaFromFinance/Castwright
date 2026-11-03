<script lang="ts">
  import type { Action } from '$lib/bindings/Action';
  import type { Graph } from '$lib/bindings/Graph';
  import type { Overlay } from '$lib/bindings/Overlay';
  import { STEP_LABELS, TRIGGER_LABELS } from './defaults';
  import { describeStep, describeTrigger } from './describe';
  import { NODE_W, anchor, arrowHead, edgeCurve, nodeRect, pathOf, type Rect } from './graph';
  import { STEP_ICONS, TRIGGER_ICONS, stepTone } from './icons';

  interface Props {
    graph: Graph;
    /** Used to name the actions and layers steps point at. */
    ctx?: { actions?: readonly Action[]; overlays?: readonly Overlay[] };
  }

  let { graph, ctx = {} }: Props = $props();

  const H = 64;
  const PAD = 24;
  const sizes = $derived(Object.fromEntries(graph.nodes.map((n) => [n.id, H])));

  const box = $derived.by(() => {
    if (!graph.nodes.length) return { x: 0, y: 0, w: 1, h: 1 };
    const xs = graph.nodes.map((n) => n.x);
    const ys = graph.nodes.map((n) => n.y);
    const x = Math.min(...xs) - PAD;
    const y = Math.min(...ys) - PAD;
    return { x, y, w: Math.max(...xs) + NODE_W + PAD - x, h: Math.max(...ys) + H + PAD - y };
  });

  const nodes = $derived(
    graph.nodes.map((n) => {
      const r = nodeRect(n, sizes);
      if (n.kind.type === 'trigger') {
        const t = n.kind.trigger;
        return { id: n.id, r, icon: TRIGGER_ICONS[t.type], tone: 'trigger', title: TRIGGER_LABELS[t.type], text: describeTrigger(t) };
      }
      const s = n.kind.step;
      return { id: n.id, r, icon: STEP_ICONS[s.type], tone: stepTone(s.type), title: STEP_LABELS[s.type], text: describeStep(s, ctx) };
    })
  );

  const rects = $derived(new Map<string, Rect>(nodes.map((n) => [n.id, n.r])));
  const edges = $derived(
    graph.edges.flatMap((e) => {
      const a = rects.get(e.from);
      const b = rects.get(e.to);
      if (!a || !b) return [];
      const d = pathOf(edgeCurve(a, e.from_side, b, e.to_side));
      return [{ id: e.id, d, head: arrowHead(anchor(b, e.to_side), e.to_side), branch: e.branch }];
    })
  );
</script>

<div class="preview" role="img" aria-label="Preview of the flow">
  <svg viewBox="{box.x} {box.y} {box.w} {box.h}" preserveAspectRatio="xMidYMid meet">
    {#each edges as e (e.id)}
      <path class="line {e.branch}" d={e.d} />
      <polygon class="head {e.branch}" points={e.head} />
    {/each}
    {#each nodes as n (n.id)}
      {@const Icon = n.icon}
      <foreignObject x={n.r.x} y={n.r.y} width={n.r.w} height={n.r.h}>
        <div class="node tone-{n.tone}">
          <span class="icon"><Icon size={18} /></span>
          <span class="text">
            <span class="title">{n.title}</span>
            <span class="sum">{n.text || 'Not set up yet'}</span>
          </span>
        </div>
      </foreignObject>
    {/each}
  </svg>
</div>

<style>
  .preview {
    width: 100%;
    height: 100%;
    min-height: 0;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  .line {
    fill: none;
    stroke: var(--border-strong);
    stroke-width: 2.5;
  }
  .head {
    fill: var(--border-strong);
  }
  .line.then {
    stroke: var(--ok);
  }
  .head.then {
    fill: var(--ok);
  }
  .line.otherwise {
    stroke: var(--danger);
  }
  .head.otherwise {
    fill: var(--danger);
  }
  .node {
    --tone: var(--accent);
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    height: 100%;
    padding: 0 14px;
    border: 1.5px solid color-mix(in srgb, var(--tone) 45%, var(--border));
    border-radius: 12px;
    background: color-mix(in srgb, var(--tone) 8%, var(--bg-1));
    color: var(--text);
  }
  .tone-chat {
    --tone: #4f8cff;
  }
  .tone-twitch {
    --tone: #9b6bff;
  }
  .tone-obs {
    --tone: #27b3a3;
  }
  .tone-media {
    --tone: #e3649f;
  }
  .tone-vars {
    --tone: #d99a2b;
  }
  .tone-logic {
    --tone: #ef7d45;
  }
  .tone-advanced {
    --tone: #8792a6;
  }
  .icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 34px;
    height: 34px;
    border-radius: 9px;
    background: color-mix(in srgb, var(--tone) 22%, transparent);
    color: color-mix(in srgb, var(--tone) 75%, var(--text));
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .title {
    font-size: 15px;
    font-weight: 650;
  }
  .sum {
    overflow: hidden;
    font-size: 13px;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--text-muted);
  }
</style>
