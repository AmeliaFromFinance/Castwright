<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import type { Action } from '$lib/bindings/Action';
  import type { EdgeSide } from '$lib/bindings/EdgeSide';
  import type { GraphNode } from '$lib/bindings/GraphNode';
  import type { NodeKind } from '$lib/bindings/NodeKind';
  import type { Permission } from '$lib/bindings/Permission';
  import type { Trigger } from '$lib/bindings/Trigger';
  import { describeConditions } from '$lib/editors/conditions';
  import { newId } from '$lib/editors/ids';
  import type { MenuGroup } from '$lib/editors/menu';
  import { isTypingTarget } from '$lib/editor/keys';
  import { app } from '$lib/state/app.svelte';
  import { toasts } from '$lib/state/toast.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import ResizeHandle from '$lib/ui/ResizeHandle.svelte';
  import { ChevronLeft, ChevronRight, Grid3x3, Group, History, Maximize, Minus, Plus, Sparkles, StickyNote, Zap } from '@lucide/svelte';
  import Menu from '$lib/editors/Menu.svelte';
  import { clock } from '$lib/format';
  import { STEP_GROUPS, STEP_LABELS, STEP_MENU, TRIGGER_LABELS, TRIGGER_MENU, newStep, newTrigger, type StepType, type TriggerType } from './defaults';
  import { describeStep, describeTrigger, every, tokensForAction } from './describe';
  import {
    DEFAULT_H,
    GRID,
    NODE_W,
    OPPOSITE,
    addEdge,
    anchor,
    arrowHead,
    copyNodes,
    curve,
    dropTarget,
    duplicateNodes,
    edgeCurve,
    freeSpot,
    isIf,
    nextBranch,
    nodeById,
    nodeRect,
    pasteClip,
    pathOf,
    placeBySide,
    pointAt,
    rectFrom,
    removeEdges,
    removeNodes,
    snap,
    unreachable,
    type Clip,
    type Point
  } from './graph';
  import FlowNode from './FlowNode.svelte';
  import FlowFrame from './FlowFrame.svelte';
  import FlowNote from './FlowNote.svelte';
  import {
    FRAME_MIN,
    NOTE_MIN,
    NOTE_SIZE,
    addNote,
    allBounds,
    allIds,
    frameById,
    frameOf,
    frameRect,
    framesOf,
    framesToUngroup,
    groupItems,
    hiddenIds,
    itemsInBox,
    lineEnds,
    moveItems,
    noteById,
    noteRect,
    notesOf,
    nudgeItems,
    patchFrame,
    patchNote,
    positions,
    resizeTo,
    tidyAll,
    ungroup,
    updateMembership,
    withMembers
  } from './canvas';
  import type { Rect } from './graph';
  import { GROUP_ICONS, STEP_ICONS, TRIGGER_ICONS, stepTone } from './icons';
  import Inspector from './Inspector.svelte';
  import Minimap from './Minimap.svelte';
  import type { NodeStatus } from './runstatus';
  import StepPicker from './StepPicker.svelte';
  import { actionsEditor as ed, flow, runLog } from './store.svelte';
  import { traceView } from './trace';
  import { centerOn, edgePan, fitView, toScreen, toWorld, visibleRect, zoomAt, type View } from './view';

  interface Props {
    action: Action;
  }

  let { action }: Props = $props();

  const PERMISSIONS: Record<Permission, string> = {
    everyone: 'Everyone',
    subscriber: 'Subscribers and up',
    vip: 'VIPs and up',
    moderator: 'Moderators',
    broadcaster: 'Only you'
  };

  let viewport: HTMLDivElement | undefined = $state();
  let root: HTMLDivElement | undefined = $state();
  let vw = $state(0);
  let vh = $state(0);
  let inspectorW = $state(440);

  const g = $derived(action.graph);
  const notes = $derived(notesOf(g));
  const frames = $derived(framesOf(g));
  /** Nodes and notes inside collapsed frames. */
  const hidden = $derived(hiddenIds(g));
  /** The graph as drawn: nodes in collapsed frames can't be hit or joined. */
  const shown = $derived({ ...g, nodes: g.nodes.filter((n) => !hidden.has(n.id)) });
  let editingNote = $state<string | null>(null);
  let renamingFrame = $state<string | null>(null);
  /** Measured node heights. */
  let sizes = $state<Record<string, number>>({});

  // View: kept per action while the app runs; a new visit fits the flow.
  const saved = untrack(() => flow.views.get(action.id));
  let view = $state<View>(saved ?? { x: 0, y: 0, zoom: 1 });
  $effect(() => {
    flow.views.set(action.id, { ...view });
  });

  const issues = $derived(ed.issues[action.id] ?? []);
  const issuesOf = (id: string) => issues.filter((i) => i.key === `node.${id}`);
  const loose = $derived(new Set(unreachable(g)));
  const ctx = $derived({ actions: ed.actions ?? [], overlays: app.project?.overlays ?? [] });
  const selected = $derived(new Set(flow.selected));

  // Run trace: the latest run, live while it runs, or a past run picked from the history.
  const live = $derived(runLog.live[action.id]);
  const past = $derived(runLog.history[action.id] ?? []);
  const lastRun = $derived(runLog.last[action.id]);
  let picked = $state<number | null>(null);
  let stepAt = $state(0);
  const replay = $derived(picked === null ? null : (past.find((t) => t.runId === picked) ?? null));
  const inProgress = $derived(!!live && !live.run);
  const running = $derived(flow.testing?.actionId === action.id || inProgress);
  const trace = $derived(traceView(replay ?? live, replay ? stepAt : undefined));

  const statusOf = (id: string): NodeStatus | undefined => {
    const s = trace.nodes.get(id);
    return s && s.state !== 'running' ? { state: s.state, errors: s.errors } : undefined;
  };

  function pickRun(id: string) {
    const t = past.find((x) => x.runId === Number(id));
    if (!t) return;
    picked = t.runId;
    stepAt = t.steps.length - 1;
  }

  function stepTo(i: number) {
    if (!replay) return;
    stepAt = Math.max(0, Math.min(replay.steps.length - 1, i));
    const id = replay.steps[stepAt]?.node;
    if (id) reveal(id);
  }

  function leaveReplay() {
    picked = null;
  }

  const runItems = $derived([
    {
      items: past.map((t) => ({
        value: String(t.runId),
        label: `${clock(t.run!.ts)} · ${t.run!.ok ? 'Worked' : `${t.run!.errors.length} error${t.run!.errors.length === 1 ? '' : 's'}`}`,
        hint: `${t.steps.length} step${t.steps.length === 1 ? '' : 's'} · ${t.run!.duration_ms} ms · ${t.run!.trigger}`
      }))
    }
  ]);
  const currentTitle = $derived.by(() => {
    const n = trace.current ? nodeById(g, trace.current) : undefined;
    return n ? nodeProps(n).title : '';
  });

  // Drop selections of nodes and lines that are gone (after undo, for example).
  $effect(() => {
    const ids = new Set(allIds(g));
    if (flow.selected.some((id) => !ids.has(id))) flow.select(flow.selected.filter((id) => ids.has(id)));
    if (flow.edge && !g.edges.some((e) => e.id === flow.edge)) flow.selectEdge(null);
  });

  // Lines

  const rects = $derived(new Map(g.nodes.map((n) => [n.id, nodeRect(n, sizes)])));
  const lines = $derived(
    g.edges.flatMap((e) => {
      const ends = lineEnds(g, sizes, e);
      if (!ends) return [];
      const { from: a, to: b } = ends;
      const c = edgeCurve(a, e.from_side, b, e.to_side);
      const ran = trace.edges.has(e.id);
      const fresh = ran && !replay && inProgress && trace.latest === e.id;
      return [{ e, d: pathOf(c), tip: anchor(b, e.to_side), mid: pointAt(c, 0.5), fromIf: isIf(nodeById(g, e.from)), ran, fresh }];
    })
  );
  const BRANCH_TEXT = { then: 'Then', otherwise: 'Otherwise', next: 'Always' } as const;

  // Pointer gestures

  type Gesture =
    | { kind: 'pan'; start: Point; from: View; moved: boolean; clear: boolean }
    | { kind: 'box'; start: Point; a: Point; b: Point; base: string[]; moved: boolean }
    | { kind: 'drag'; id: string; start: Point; from: Point; origin: Map<string, Point>; moved: boolean; toggle: boolean; additive: boolean }
    | { kind: 'connect'; start: Point; from: string; side: EdgeSide; p: Point; target: { id: string; side: EdgeSide } | null; moved: boolean }
    | { kind: 'resize'; id: string; frame: boolean; start: Point; from: Point; orig: Rect; moved: boolean };

  let gesture = $state<Gesture | null>(null);
  let space = $state(false);
  /** Last pointer position on the canvas, in world units; where Ctrl+V pastes. */
  let pointer: Point | null = null;
  /** Latest pointer during a gesture, in canvas pixels, for panning at the edges. */
  let last: { p: Point; alt: boolean; id: number } | null = null;
  let edgeFrame = 0;
  let edgeTime = 0;

  function local(e: { clientX: number; clientY: number }): Point {
    const r = viewport!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  const world = (e: { clientX: number; clientY: number }) => toWorld(view, local(e));

  function down(e: PointerEvent) {
    if (picker) return;
    const t = e.target as Element;
    downOn = t;
    if (t.closest('[data-chip], textarea, input, a')) return;
    const p = local(e);
    if (e.button === 1 || (e.button === 0 && space)) {
      gesture = { kind: 'pan', start: p, from: { ...view }, moved: false, clear: false };
      viewport!.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const wrap = t.closest<HTMLElement>('[data-node-wrap]');
    const handle = t.closest<HTMLElement>('[data-handle]');
    if (wrap && handle) {
      const from = wrap.dataset.nodeWrap!;
      gesture = { kind: 'connect', start: p, from, side: handle.dataset.handle as EdgeSide, p: toWorld(view, p), target: null, moved: false };
      viewport!.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    const resize = t.closest<HTMLElement>('[data-resize]');
    if (resize) {
      const id = resize.dataset.resize!;
      const f = frameById(g, id);
      const n = noteById(g, id);
      const orig = f ? frameRect(f) : n ? noteRect(n) : null;
      if (!orig) return;
      flow.select([id], false);
      gesture = { kind: 'resize', id, frame: !!f, start: p, from: toWorld(view, p), orig, moved: false };
      viewport!.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    const item = wrap?.dataset.nodeWrap ?? t.closest<HTMLElement>('[data-item]')?.dataset.item;
    if (item) {
      const id = item;
      const isNode = !!wrap;
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      let toggle = false;
      if (additive) {
        if (selected.has(id)) toggle = true;
        else flow.select([...flow.selected, id], false);
      } else if (!selected.has(id)) flow.select([id], isNode ? flow.inspecting : false);
      const origin = positions(g, withMembers(g, flow.selected));
      gesture = { kind: 'drag', id, start: p, from: toWorld(view, p), origin, moved: false, toggle, additive };
      viewport!.setPointerCapture(e.pointerId);
      return;
    }
    const edge = t.closest<SVGElement>('[data-edge]');
    if (edge) {
      flow.selectEdge(edge.dataset.edge!);
      viewport!.focus({ preventScroll: true });
      e.preventDefault();
      return;
    }
    viewport!.focus({ preventScroll: true });
    if (e.shiftKey) gesture = { kind: 'box', start: p, a: toWorld(view, p), b: p, base: [...flow.selected], moved: false };
    else gesture = { kind: 'pan', start: p, from: { ...view }, moved: false, clear: true };
    viewport!.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function move(e: PointerEvent) {
    const p = local(e);
    pointer = toWorld(view, p);
    if (!gesture) return;
    last = { p, alt: e.altKey, id: e.pointerId };
    apply(p, e.altKey);
    if (!edgeFrame && edgeArmed()) {
      edgeTime = 0;
      edgeFrame = requestAnimationFrame(edgeTick);
    }
  }

  /** Update the gesture for the pointer at `p` (canvas pixels) and the current view. */
  function apply(p: Point, alt: boolean) {
    const gs = gesture;
    if (!gs) return;
    const w = toWorld(view, p);
    const far = (a: Point, n: number) => Math.hypot(p.x - a.x, p.y - a.y) >= n;
    if (gs.kind === 'pan') {
      const dx = p.x - gs.start.x;
      const dy = p.y - gs.start.y;
      if (!gs.moved && !far(gs.start, 3)) return;
      gs.moved = true;
      view = { ...gs.from, x: gs.from.x + dx, y: gs.from.y + dy };
    } else if (gs.kind === 'box') {
      if (!gs.moved && !far(gs.start, 3)) return;
      gs.moved = true;
      gs.b = p;
      flow.select([...new Set([...gs.base, ...itemsInBox(g, sizes, rectFrom(gs.a, w))])], false);
    } else if (gs.kind === 'drag') {
      if (!gs.moved && !far(gs.start, 4)) return;
      gs.moved = true;
      // Measured in the world, so the nodes stay under the pointer while the view pans.
      const dx = w.x - gs.from.x;
      const dy = w.y - gs.from.y;
      const grid = flow.snap && !alt;
      // With a frame in the drag, everything moves by the frame's snapped step, so its contents keep their places.
      const lead = frames.find((f) => gs.origin.has(f.id));
      const lo = lead ? gs.origin.get(lead.id)! : null;
      const sx = lo && grid ? snap(lo.x + dx) - lo.x : dx;
      const sy = lo && grid ? snap(lo.y + dy) - lo.y : dy;
      const to = new Map(
        [...gs.origin].map(([id, o]) => [id, lo || !grid ? { x: o.x + sx, y: o.y + sy } : { x: snap(o.x + dx), y: snap(o.y + dy) }])
      );
      ed.updateGraph(action.id, (gr) => moveItems(gr, to), 'drag', Infinity);
    } else if (gs.kind === 'resize') {
      if (!gs.moved && !far(gs.start, 3)) return;
      gs.moved = true;
      const size = resizeTo(gs.orig, w.x - gs.from.x, w.y - gs.from.y, gs.frame ? FRAME_MIN : NOTE_MIN, flow.snap && !alt);
      ed.updateGraph(action.id, (gr) => (gs.frame ? patchFrame(gr, gs.id, size) : patchNote(gr, gs.id, size)), 'resize', Infinity);
    } else {
      if (!gs.moved && far(gs.start, 4)) gs.moved = true;
      gs.p = w;
      gs.target = dropTarget(shown, sizes, w, 18 / view.zoom, gs.from);
    }
  }

  /** Dragging a node, drawing a line or a selection box pans the view near the edges. */
  function edgeArmed(): boolean {
    const gs = gesture;
    return !!gs && gs.kind !== 'pan' && gs.moved && !!last;
  }

  function edgeTick(t: number) {
    edgeFrame = 0;
    if (!edgeArmed()) return;
    const d = edgePan(last!.p, vw, vh, edgeTime ? t - edgeTime : undefined);
    edgeTime = t;
    if (!d.x && !d.y) return;
    view = { ...view, x: view.x + d.x, y: view.y + d.y };
    apply(last!.p, last!.alt);
    edgeFrame = requestAnimationFrame(edgeTick);
  }

  function stopEdge() {
    if (edgeFrame) cancelAnimationFrame(edgeFrame);
    edgeFrame = 0;
    last = null;
  }

  function up(e: PointerEvent) {
    stopEdge();
    const gs = gesture;
    gesture = null;
    if (viewport?.hasPointerCapture(e.pointerId)) viewport.releasePointerCapture(e.pointerId);
    if (!gs) return;
    if (gs.kind === 'pan') {
      if (!gs.moved && gs.clear) flow.clear();
    } else if (gs.kind === 'drag') {
      const isNode = !!nodeById(g, gs.id);
      if (gs.moved) {
        dropped(gs.origin);
        ed.seal(action.id);
      } else if (gs.toggle) flow.select(flow.selected.filter((x) => x !== gs.id), false);
      else if (!gs.additive) flow.select([gs.id], isNode);
      if (isNode) focusNode(gs.id);
    } else if (gs.kind === 'resize') {
      if (gs.moved) {
        if (gs.frame) refit(gs.id);
        ed.seal(action.id);
      }
    } else if (gs.kind === 'connect') {
      const p = world(e);
      if (gs.target) connect(gs.from, gs.side, gs.target.id, gs.target.side);
      else if (!shown.nodes.some((n) => rects.get(n.id) && contains(rects.get(n.id)!, p))) {
        openPicker({ kind: 'step', at: p, link: { from: gs.from, side: gs.side }, anchor: new DOMRect(e.clientX, e.clientY, 0, 0) });
      }
    }
  }

  /** Esc during a gesture: stop where it is. A line being drawn is dropped. */
  function cancelGesture() {
    const id = last?.id;
    stopEdge();
    const gs = gesture;
    gesture = null;
    if (id !== undefined && viewport?.hasPointerCapture(id)) viewport.releasePointerCapture(id);
    if (gs?.kind === 'drag' && gs.moved) dropped(gs.origin);
    if ((gs?.kind === 'drag' || gs?.kind === 'resize') && gs.moved) ed.seal(action.id);
  }

  /** Nodes and notes dropped over a frame join it; dragged out, they leave. What a moved frame holds stays. */
  function dropped(moved: ReadonlyMap<string, Point>) {
    const carried = new Set(frames.filter((f) => moved.has(f.id)).flatMap((f) => f.members));
    const ids = [...moved.keys()].filter((id) => !carried.has(id) && !frameById(g, id));
    if (ids.length) ed.updateGraph(action.id, (gr) => updateMembership(gr, ids, sizes), 'drag', Infinity);
  }

  /** After resizing a frame: what's now inside joins it, what's outside leaves. */
  function refit(frameId: string) {
    const f = frameById(g, frameId);
    if (!f) return;
    const r = frameRect(f);
    const inside = (q: Rect) => contains(r, { x: q.x + q.w / 2, y: q.y + q.h / 2 });
    const ids = [
      ...f.members,
      ...shown.nodes.filter((n) => inside(rects.get(n.id)!)).map((n) => n.id),
      ...notes.filter((n) => !hidden.has(n.id) && inside(noteRect(n))).map((n) => n.id)
    ];
    ed.updateGraph(action.id, (gr) => updateMembership(gr, new Set(ids), sizes), 'resize', Infinity);
  }

  const contains = (r: { x: number; y: number; w: number; h: number }, p: Point) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

  function connect(from: string, fromSide: EdgeSide, to: string, toSide: EdgeSide) {
    let made: string | null = null;
    ed.updateGraph(action.id, (gr) => {
      const r = addEdge(gr, { from, from_side: fromSide, to, to_side: toSide });
      made = r?.edge.id ?? null;
      return r?.graph ?? null;
    });
    if (made) flow.selectEdge(made);
  }

  /** Where the last press started. Pointer capture sends the double-click to the canvas itself. */
  let downOn: Element | null = null;

  function dblclick(e: MouseEvent) {
    const t = (downOn?.isConnected ? downOn : e.target) as Element;
    const noteEl = t.closest<HTMLElement>('[data-note]');
    if (noteEl && !t.closest('[data-chip], textarea, [data-resize]')) {
      editingNote = noteEl.dataset.note!;
      return;
    }
    const bar = t.closest<HTMLElement>('[data-frame] [data-item]');
    if (bar && !t.closest('[data-chip], input')) {
      renamingFrame = bar.dataset.item!;
      return;
    }
    if (t.closest('[data-node-wrap], [data-edge], [data-chip], [data-item], [data-note]')) return;
    if (e.shiftKey) {
      const p = world(e);
      newNote({ x: p.x - NOTE_SIZE.w / 2, y: p.y - 24 });
      return;
    }
    openPicker({ kind: 'step', at: world(e), anchor: new DOMRect(e.clientX, e.clientY, 0, 0) });
  }

  // View

  function zoomBy(f: number, at: Point = { x: vw / 2, y: vh / 2 }) {
    view = zoomAt(view, view.zoom * f, at);
  }

  /** Pan just enough to show a node, e.g. after adding it or when the inspector narrows the canvas. */
  function reveal(id: string) {
    const r = rects.get(id);
    if (!r || !vw || !vh) return;
    const pad = 32;
    const a = toScreen(view, { x: r.x, y: r.y });
    const w = r.w * view.zoom;
    const h = Math.min(r.h * view.zoom, vh - pad * 2);
    let dx = 0;
    let dy = 0;
    if (a.x + w > vw - pad) dx = vw - pad - (a.x + w);
    if (a.x + dx < pad) dx = pad - a.x;
    if (a.y + h > vh - pad - 60) dy = vh - pad - 60 - (a.y + h);
    if (a.y + dy < pad + 40) dy = pad + 40 - a.y;
    if (dx || dy) view = { ...view, x: view.x + dx, y: view.y + dy };
  }

  $effect(() => {
    const id = flow.inspected;
    void vw;
    if (id) untrack(() => requestAnimationFrame(() => reveal(id)));
  });

  // Jump here from elsewhere, like the variable details: select the node and center it.
  $effect(() => {
    const f = flow.focus;
    if (!f || f.actionId !== action.id) return;
    untrack(() => {
      flow.focus = null;
      if (!nodeById(g, f.nodeId)) return;
      requestAnimationFrame(() => {
        flow.select([f.nodeId], true);
        requestAnimationFrame(() => {
          const r = rects.get(f.nodeId);
          if (r) view = centerOn(view, { x: r.x + r.w / 2, y: r.y + Math.min(r.h, 200) / 2 }, vw, vh);
          focusNode(f.nodeId);
        });
      });
    });
  });

  function fit() {
    // Room for the toolbar on top, and the add bar and overview below. A narrow canvas
    // has no room beside the overview, so keep clear above it.
    const side = vw > 900 ? 230 : 56;
    const bottom = vw > 900 || vw <= 760 ? 84 : 190;
    view = fitView(allBounds(g, sizes), vw, vh, { top: 64, right: side, bottom, left: side }, 1);
  }

  onMount(() => {
    const el = viewport!;
    const wheel = (e: WheelEvent) => {
      if (picker) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomBy(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018)), local(e));
      } else {
        const k = e.deltaMode === 1 ? 16 : 1;
        const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k;
        const dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k;
        view = { ...view, x: view.x - dx, y: view.y - dy };
      }
    };
    // Focus can scroll a clipped box; the view moves only by panning.
    const scroll = () => {
      el.scrollLeft = 0;
      el.scrollTop = 0;
    };
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('scroll', scroll);
    if (!saved) {
      // Wait a frame so nodes have been measured.
      requestAnimationFrame(() => fit());
    }
    return () => {
      stopEdge();
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('scroll', scroll);
    };
  });

  function measure(el: HTMLElement, id: string) {
    const ro = new ResizeObserver(() => {
      const h = el.offsetHeight;
      if (h && sizes[id] !== h) sizes[id] = h;
    });
    ro.observe(el);
    return { destroy: () => ro.disconnect() };
  }

  // Editing

  function addNode(kind: NodeKind, topLeft: Point, link?: { from: string; side: EdgeSide }) {
    const id = newId();
    const at = flow.snap ? { x: snap(topLeft.x), y: snap(topLeft.y) } : topLeft;
    ed.updateGraph(action.id, (gr) => {
      gr.nodes.push({ id, x: at.x, y: at.y, kind });
      if (!link) return gr;
      return addEdge(gr, { from: link.from, from_side: link.side, to: id, to_side: OPPOSITE[link.side] })?.graph ?? gr;
    });
    flow.select([id], true);
    focusNode(id);
  }

  function removeSelected() {
    if (flow.selected.length) {
      const n = flow.selected.length;
      const what = n > 1 ? `${n} items` : nodeById(g, flow.selected[0]!) ? 'Node' : noteById(g, flow.selected[0]!) ? 'Note' : 'Frame';
      ed.updateGraph(action.id, (gr) => removeNodes(gr, flow.selected));
      flow.clear();
      toasts.show(`${what} deleted. Ctrl+Z brings ${n === 1 ? 'it' : 'them'} back.`);
    } else if (flow.edge) {
      const id = flow.edge;
      ed.updateGraph(action.id, (gr) => removeEdges(gr, [id]));
      flow.selectEdge(null);
    }
  }

  function duplicateSelected() {
    if (!flow.selected.length) return;
    let ids: string[] = [];
    ed.updateGraph(action.id, (gr) => {
      const r = duplicateNodes(gr, flow.selected, { x: GRID * 2, y: GRID * 2 });
      ids = r.ids;
      return r.graph;
    });
    flow.select(ids, false);
  }

  function copySelected(cut: boolean) {
    if (!flow.selected.length) return;
    flow.clipboard = copyNodes($state.snapshot(g) as typeof g, flow.selected);
    if (cut) removeSelected();
    else toasts.show(flow.selected.length === 1 ? 'Copied' : `Copied ${flow.selected.length} items`);
  }

  function paste() {
    const clip = $state.snapshot(flow.clipboard) as Clip | null;
    if (!clip || !(clip.nodes.length || clip.notes?.length || clip.frames?.length)) return;
    const at = pointer && contains(visibleRect(view, vw, vh), pointer) ? pointer : toWorld(view, { x: vw / 2 - NODE_W / 2, y: vh / 3 });
    let ids: string[] = [];
    ed.updateGraph(action.id, (gr) => {
      const r = pasteClip(gr, clip, flow.snap ? { x: snap(at.x), y: snap(at.y) } : at);
      ids = r.ids;
      const carried = new Set(framesOf(r.graph).filter((f) => ids.includes(f.id)).flatMap((f) => f.members));
      return updateMembership(r.graph, ids.filter((id) => !carried.has(id)), sizes);
    });
    flow.select(ids, false);
  }

  function nudge(dx: number, dy: number) {
    if (!flow.selected.length) return;
    ed.updateGraph(action.id, (gr) => nudgeItems(gr, flow.selected, dx, dy), 'nudge');
  }

  async function tidyUp() {
    if (ed.updateGraph(action.id, (gr) => tidyAll(gr, sizes))) {
      await tick();
      requestAnimationFrame(() => fit());
    }
  }

  // Notes and frames

  function newNote(at: Point) {
    let id = '';
    const p = flow.snap ? { x: snap(at.x), y: snap(at.y) } : at;
    ed.updateGraph(action.id, (gr) => {
      const r = addNote(gr, p);
      id = r.id;
      return r.graph;
    });
    flow.select([id], false);
    editingNote = id;
  }

  function noteFromBar() {
    const c = toWorld(view, { x: vw / 2, y: vh / 2 });
    newNote({ x: c.x - NOTE_SIZE.w / 2, y: c.y - NOTE_SIZE.h / 2 });
  }

  const canGroup = $derived(flow.selected.some((id) => nodeById(g, id) || noteById(g, id) || frameById(g, id)));

  function group() {
    let made: string | null = null;
    ed.updateGraph(action.id, (gr) => {
      const r = groupItems(gr, flow.selected, sizes);
      made = r?.id ?? null;
      return r?.graph ?? null;
    });
    if (made) {
      flow.select([made], false);
      toasts.show('Grouped. Double-click the title to rename it.');
    }
  }

  function ungroupSelected() {
    const ids = framesToUngroup(g, flow.selected);
    if (!ids.length) return;
    const keep = frames.filter((f) => ids.includes(f.id)).flatMap((f) => f.members);
    ed.updateGraph(action.id, (gr) => ungroup(gr, ids));
    flow.select(keep, false);
  }

  function setNote(id: string, patch: Parameters<typeof patchNote>[2], key: string | null = null) {
    ed.updateGraph(action.id, (gr) => patchNote(gr, id, patch), key);
  }

  function setFrame(id: string, patch: Parameters<typeof patchFrame>[2], key: string | null = null) {
    ed.updateGraph(action.id, (gr) => patchFrame(gr, id, patch), key);
  }

  const single = $derived(flow.selected.length === 1 ? flow.selected[0]! : null);
  const nodesIn = (id: string) => frameById(g, id)?.members.filter((m) => nodeById(g, m)).length ?? 0;

  function setBranch(edgeId: string) {
    ed.updateGraph(action.id, (gr) => {
      const e = gr.edges.find((x) => x.id === edgeId);
      if (e) e.branch = nextBranch(e.branch);
      return gr;
    });
  }

  // Picker for new steps and triggers

  type Pick = { kind: 'step' | 'trigger'; group?: string; anchor: DOMRect; at?: Point; link?: { from: string; side: EdgeSide } };
  let picker = $state<Pick | null>(null);

  function openPicker(p: Pick) {
    picker = p;
  }

  const stepGroups = $derived(picker?.kind === 'step' && picker.group ? STEP_MENU.filter((x) => x.label === picker!.group) : STEP_MENU);

  /** Where a node added from the bottom bar goes: under the one selected node, else the middle of the view. */
  function fromBar(e: MouseEvent, kind: 'step' | 'trigger', group?: string) {
    const anchorRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const one = flow.selected.length === 1 ? nodeById(g, flow.selected[0]!) : undefined;
    if (kind === 'step' && one) {
      const r = nodeRect(one, sizes);
      openPicker({ kind, group, anchor: anchorRect, at: { x: r.x + r.w / 2, y: r.y + r.h + 64 }, link: { from: one.id, side: 'bottom' } });
      return;
    }
    openPicker({ kind, group, anchor: anchorRect });
  }

  function placeNew(p: Pick): Point {
    if (p.link && p.at) return placeBySide(p.at, OPPOSITE[p.link.side]);
    if (p.at) return { x: p.at.x - NODE_W / 2, y: p.at.y - DEFAULT_H / 2 };
    const c = toWorld(view, { x: vw / 2, y: vh / 2 });
    return freeSpot(g, { x: c.x - NODE_W / 2, y: c.y - DEFAULT_H / 2 - (p.kind === 'trigger' ? 80 : 0) });
  }

  function pickStep(type: StepType) {
    const p = picker!;
    addNode({ type: 'step', step: newStep(type) }, placeNew(p), p.link);
  }

  function pickTrigger(type: TriggerType) {
    addNode({ type: 'trigger', trigger: newTrigger(type) }, placeNew(picker!));
  }

  // Keyboard

  function focusNode(id: string) {
    void tick().then(() => root?.querySelector<HTMLElement>(`[data-node="${id}"]`)?.focus({ preventScroll: true }));
  }

  function inScope(e: KeyboardEvent): boolean {
    if (e.defaultPrevented || isTypingTarget(e.target) || picker) return false;
    const t = e.target as Element | null;
    if (!t || t === document.body) return true;
    if (!root?.contains(t) || t.closest('.inspector')) return false;
    return !t.closest('[role="menu"], [role="dialog"], select');
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && gesture && gesture.kind !== 'pan') {
      cancelGesture();
      e.preventDefault();
      return;
    }
    // Escape closes the inspector from anywhere on the page, except in fields and popups.
    if (e.key === 'Escape' && flow.inspecting && !e.defaultPrevented && !isTypingTarget(e.target) && !picker) {
      const t = e.target as Element | null;
      if (!t?.closest?.('[role="menu"], [role="dialog"]')) {
        flow.inspecting = false;
        if (flow.selected[0]) focusNode(flow.selected[0]);
        e.preventDefault();
        return;
      }
    }
    if (!inScope(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (mod && !e.altKey) {
      if (key === 'd') duplicateSelected();
      else if (key === 'c' && flow.selected.length) copySelected(false);
      else if (key === 'x' && flow.selected.length) copySelected(true);
      else if (key === 'v' && flow.clipboard) paste();
      else if (key === 'a') flow.select(allIds(g), false);
      else if (key === 'g' && e.shiftKey) ungroupSelected();
      else if (key === 'g') group();
      else return;
      e.preventDefault();
      return;
    }
    if (e.altKey) return;
    const step = e.shiftKey ? GRID : 1;
    const arrows: Record<string, [number, number]> = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] };
    if (arrows[key] && flow.selected.length) nudge(...arrows[key]!);
    else if (key === 'Delete' || key === 'Backspace') removeSelected();
    else if (key === 'Escape') {
      if (replay) leaveReplay();
      else flow.clear();
    }
    else if (key === 'f') fit();
    else if (key === ' ' && (!(e.target as Element)?.closest?.('button') || (e.target as Element).closest('[data-node]'))) space = true;
    else if (key === 'Enter' && single && !(e.target as Element)?.closest?.('button')) {
      if (nodeById(g, single)) flow.select(flow.selected, true);
      else if (noteById(g, single)) editingNote = single;
      else renamingFrame = single;
    }
    else return;
    e.preventDefault();
  }

  function onKeyUp(e: KeyboardEvent) {
    if (e.key === ' ') space = false;
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Meta') ed.seal(action.id);
  }

  // Node content

  function triggerRows(t: Trigger): Array<[string, string]> {
    switch (t.type) {
      case 'command':
        return [
          ['Who', PERMISSIONS[t.permission]],
          ...(t.aliases.length ? [['Also', t.aliases.map((x) => `!${x}`).join(' ')] as [string, string]] : []),
          ...(t.user_cooldown_s ? [['Per viewer', every(t.user_cooldown_s)] as [string, string]] : [])
        ];
      case 'event':
        return [['Only if', describeConditions(t.conditions, 'Every time')]];
      case 'timer':
        return [
          ['While live', t.only_when_live ? 'Only' : 'Always'],
          ...(t.min_chat_lines ? [['Chat lines', `At least ${t.min_chat_lines}`] as [string, string]] : [])
        ];
      case 'manual':
        return [['From', 'Test, Stream Deck, web']];
      default:
        return [];
    }
  }

  const outputs = (t: Trigger) =>
    tokensForAction({ ...action, triggers: [t] })
      .map((x) => x.token.split('|')[0]!.trim())
      .filter((x) => !x.startsWith('stream.'))
      .slice(0, 6);

  function nodeProps(n: GraphNode) {
    if (n.kind.type === 'trigger') {
      const t = n.kind.trigger;
      return { icon: TRIGGER_ICONS[t.type], tone: 'trigger', title: TRIGGER_LABELS[t.type], summary: describeTrigger(t), rows: triggerRows(t), chips: outputs(t), trigger: true };
    }
    const s = n.kind.step;
    return { icon: STEP_ICONS[s.type], tone: stepTone(s.type), title: s.type === 'if' ? 'If' : STEP_LABELS[s.type], summary: describeStep(s, ctx), rows: [], chips: [], trigger: false };
  }

  // Drawing helpers

  const connectPath = $derived.by(() => {
    const gs = gesture;
    if (gs?.kind !== 'connect') return null;
    const r = rects.get(gs.from);
    if (!r) return null;
    const a = anchor(r, gs.side);
    const tr = gs.target ? rects.get(gs.target.id) : undefined;
    if (gs.target && tr) return pathOf(edgeCurve(r, gs.side, tr, gs.target.side));
    return pathOf(curve(a, gs.side, gs.p, null));
  });

  const marquee = $derived(gesture?.kind === 'box' && gesture.moved ? rectFrom(toScreen(view, gesture.a), gesture.b) : null);
  const dot = $derived(GRID * (view.zoom < 0.6 ? 2 : 1) * view.zoom);
  const visible = $derived(visibleRect(view, vw, vh));
  const mapNodes = $derived(shown.nodes.map((n) => ({ ...rects.get(n.id)!, id: n.id, trigger: n.kind.type === 'trigger', selected: selected.has(n.id) })));
  const mapNotes = $derived(notes.filter((n) => !hidden.has(n.id)).map((n) => ({ ...noteRect(n), id: n.id, color: n.color })));
  const mapFrames = $derived(frames.map((f) => ({ ...frameRect(f), id: f.id, color: f.color })));
  const cursor = $derived(
    gesture?.kind === 'pan' && gesture.moved
      ? 'grabbing'
      : gesture?.kind === 'connect'
        ? 'crosshair'
        : gesture?.kind === 'resize'
          ? 'nwse-resize'
          : gesture?.kind === 'drag' && gesture.moved
            ? 'grabbing'
            : space
              ? 'grab'
              : 'default'
  );
  const stats = $derived(`${g.nodes.length} node${g.nodes.length === 1 ? '' : 's'} · ${g.edges.length} line${g.edges.length === 1 ? '' : 's'}`);
  const toScreenPt = (p: Point) => toScreen(view, p);
</script>

<svelte:window onkeydown={onKey} onkeyup={onKeyUp} onblur={() => (space = false)} />

<div class="flow" bind:this={root}>
  <div class="canvas-wrap">
    <div
      class="canvas"
      bind:this={viewport}
      bind:clientWidth={vw}
      bind:clientHeight={vh}
      tabindex="-1"
      role="region"
      aria-label="Flow of {action.name || 'this action'}"
      style="cursor:{cursor};background-size:{dot}px {dot}px;background-position:{view.x}px {view.y}px"
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={up}
      ondblclick={dblclick}
      onpointerleave={() => {
        if (!gesture) pointer = null;
      }}
    >
      <div class="world" class:connecting={gesture?.kind === 'connect'} style="transform:translate({view.x}px, {view.y}px) scale({view.zoom})">
        {#each frames as f (f.id)}
          <FlowFrame
            frame={f}
            selected={selected.has(f.id)}
            count={f.collapsed ? nodesIn(f.id) : 0}
            renaming={renamingFrame === f.id}
            tools={single === f.id}
            onrename={(on) => (renamingFrame = on ? f.id : null)}
            onlabel={(label) => setFrame(f.id, { label }, `f.${f.id}.label`)}
            oncolor={(color) => setFrame(f.id, { color })}
            ontoggle={() => setFrame(f.id, { collapsed: !f.collapsed })}
          />
        {/each}
        <svg class="edges" width="1" height="1" aria-hidden="true">
          {#each lines as l (l.e.id)}
            <g class="edge b-{l.e.branch}" class:if={l.fromIf} class:selected={flow.edge === l.e.id} class:ran={l.ran} class:fresh={l.fresh} data-edge={l.e.id} data-from={l.e.from} data-to={l.e.to} data-to-side={l.e.to_side} data-branch={l.e.branch}>
              <path class="hit" d={l.d} />
              <path class="line" d={l.d} />
              {#if l.fresh}<path class="spark" d={l.d} />{/if}
              <polygon class="head" points={arrowHead(l.tip, l.e.to_side)} />
            </g>
          {/each}
          {#if connectPath}
            <path class="draft" d={connectPath} />
          {/if}
        </svg>

        {#each lines as l (l.e.id)}
          {#if l.fromIf}
            <button
              type="button"
              class="bchip b-{l.e.branch}"
              class:selected={flow.edge === l.e.id}
              data-chip
              style="left:{l.mid.x}px;top:{l.mid.y}px"
              title="Click to switch between Then, Otherwise and Always"
              onclick={() => setBranch(l.e.id)}>{BRANCH_TEXT[l.e.branch]}</button
            >
          {/if}
        {/each}

        {#each notes as note (note.id)}
          {#if !hidden.has(note.id)}
            <FlowNote
              {note}
              selected={selected.has(note.id)}
              editing={editingNote === note.id}
              tools={single === note.id}
              onedit={(on) => (editingNote = on ? note.id : null)}
              ontext={(text) => setNote(note.id, { text }, `nt.${note.id}`)}
              oncolor={(color) => setNote(note.id, { color })}
            />
          {/if}
        {/each}

        {#each shown.nodes as n (n.id)}
          {@const p = nodeProps(n)}
          <div
            class="gn"
            class:lifted={gesture?.kind === 'drag' && gesture.moved && selected.has(n.id)}
            style="left:{n.x}px;top:{n.y}px"
            data-node-wrap={n.id}
            data-x={Math.round(n.x)}
            data-y={Math.round(n.y)}
            use:measure={n.id}
          >
            <FlowNode
              id={n.id}
              icon={p.icon}
              tone={p.tone}
              title={p.title}
              summary={p.summary}
              rows={p.rows}
              chips={p.chips}
              trigger={p.trigger}
              issues={issuesOf(n.id)}
              status={statusOf(n.id)}
              running={trace.nodes.get(n.id)?.state === 'running'}
              current={trace.current === n.id}
              selected={selected.has(n.id)}
              loose={loose.has(n.id)}
              hot={gesture?.kind === 'connect' && gesture.target?.id === n.id ? gesture.target.side : null}
              onactivate={() => flow.select([n.id], true)}
            />
          </div>
        {/each}
      </div>

      {#if marquee}
        <div class="marquee" style="left:{marquee.x}px;top:{marquee.y}px;width:{marquee.w}px;height:{marquee.h}px"></div>
      {/if}

      {#if !g.nodes.length && !notes.length && !frames.length}
        <div class="empty">
          <span class="empty-ic"><Zap size={18} /></span>
          <p class="empty-title">Start with a trigger</p>
          <p class="faint">What should start this action? A chat command, a raid, a timer, a button…</p>
          <button type="button" class="empty-btn" data-chip onclick={(e) => fromBar(e, 'trigger')}><Plus size={14} />Add trigger</button>
          <p class="faint small">Or double-click anywhere to add a step.</p>
        </div>
      {/if}
    </div>

    {#if replay}
      {@const r = replay.run!}
      <div class="runbar replay" role="toolbar" aria-label="Past run">
        <span class="label"><span class="dot" class:bad={!r.ok} aria-hidden="true"></span>Run at {clock(r.ts)}</span>
        <IconButton size="sm" label="Previous step" disabled={stepAt <= 0} onclick={() => stepTo(stepAt - 1)}><ChevronLeft /></IconButton>
        <span class="stepno mono" aria-live="polite">Step {Math.max(0, stepAt + 1)} of {replay.steps.length}</span>
        <IconButton size="sm" label="Next step" disabled={stepAt >= replay.steps.length - 1} onclick={() => stepTo(stepAt + 1)}><ChevronRight /></IconButton>
        {#if currentTitle}<span class="cur truncate" title={currentTitle}>{currentTitle}</span>{/if}
        <button type="button" class="live" title="Back to the latest run (Esc)" onclick={leaveReplay}>Live</button>
      </div>
    {:else if running || lastRun}
      <div class="runbar">
        <div class="runchip" class:bad={!running && lastRun && !lastRun.ok} role="status">
          {#if running}
            <span class="spin" aria-hidden="true"></span>Running…
          {:else if lastRun}
            <span class="dot" aria-hidden="true"></span>Last run {lastRun.ok ? 'worked' : `had ${lastRun.errors.length} error${lastRun.errors.length === 1 ? '' : 's'}`}
            <span class="faint mono">{lastRun.duration_ms} ms · {lastRun.trigger}</span>
          {/if}
        </div>
        {#if past.length}
          <span class="runs">
            <Menu groups={runItems} label="Past runs" variant="ghost" onselect={pickRun}><History size={13} />Runs <span class="mono faint">{past.length}</span></Menu>
          </span>
        {/if}
      </div>
    {/if}

    <div class="tools" role="toolbar" aria-label="Canvas">
      <button
        type="button"
        class="tool"
        class:on={flow.snap}
        aria-pressed={flow.snap}
        aria-label="Snap"
        title="Snap to grid (hold Alt while dragging to place freely)"
        onclick={() => flow.setSnap(!flow.snap)}><Grid3x3 size={14} /><span>Snap</span></button
      >
      <button type="button" class="tool" aria-label="Tidy up" title="Arrange the nodes neatly (one undo step)" disabled={!g.nodes.length} onclick={tidyUp}
        ><Sparkles size={14} /><span>Tidy up</span></button
      >
      <button type="button" class="tool" aria-label="Group in a frame" title="Put the selected nodes in a frame (Ctrl+G)" disabled={!canGroup} onclick={group}
        ><Group size={14} /><span>Group</span></button
      >
      <span class="sep" aria-hidden="true"></span>
      <IconButton size="sm" label="Zoom out" onclick={() => zoomBy(1 / 1.2)}><Minus /></IconButton>
      <button type="button" class="pct mono" title="Reset zoom to 100%" onclick={() => (view = zoomAt(view, 1, { x: vw / 2, y: vh / 2 }))}
        >{Math.round(view.zoom * 100)}%</button
      >
      <IconButton size="sm" label="Zoom in" onclick={() => zoomBy(1.2)}><Plus /></IconButton>
      <IconButton size="sm" label="Fit to view (F)" onclick={fit}><Maximize /></IconButton>
    </div>

    <div class="palette" role="toolbar" aria-label="Add to the flow">
      <button type="button" class="chip trig" title="Add trigger" aria-label="Add trigger" onclick={(e) => fromBar(e, 'trigger')}
        ><Zap size={14} /><span>Trigger</span></button
      >
      <button type="button" class="chip note" title="Add a sticky note (or Shift + double-click the canvas)" aria-label="Add note" onclick={noteFromBar}
        ><StickyNote size={14} /><span>Note</span></button
      >
      <span class="psep" aria-hidden="true"></span>
      {#each STEP_GROUPS as g (g.label)}
        {@const Icon = GROUP_ICONS[g.label]}
        <button type="button" class="chip" title="Add {g.label} step" aria-label={g.label} onclick={(e) => fromBar(e, 'step', g.label)}>
          {#if Icon}<Icon size={14} />{/if}<span>{g.label}</span>
        </button>
      {/each}
    </div>

    <div class="hint faint" aria-hidden="true">
      <span>Drag to pan</span><span><kbd>Shift</kbd> + drag to select</span><span><kbd>Ctrl</kbd> + scroll to zoom</span><span>Double-click to add a step</span><span><kbd>Shift</kbd> + double-click for a note</span>
    </div>

    {#if g.nodes.length || notes.length || frames.length}
      <div class="map" aria-label="Overview">
        <Minimap nodes={mapNodes} notes={mapNotes} frames={mapFrames} {visible} onjump={(p) => (view = centerOn(view, p, vw, vh))} />
        <span class="stats faint">{stats}</span>
      </div>
    {/if}
  </div>

  {#if flow.inspected && nodeById(g, flow.inspected)}
    {@const id = flow.inspected}
    <ResizeHandle bind:size={inspectorW} id="automation.inspector" min={340} max={760} initial={440} panel="after" label="Resize inspector" />
    <div class="inspector" style="width:{inspectorW}px">
      <Inspector
        {action}
        nodeId={id}
        onclose={() => {
          flow.inspecting = false;
          focusNode(id);
        }}
        onduplicate={duplicateSelected}
        ondelete={removeSelected}
      />
    </div>
  {/if}
</div>

{#if picker?.kind === 'step'}
  <StepPicker
    groups={stepGroups as MenuGroup<StepType>[]}
    label="Add a step"
    anchor={picker.anchor}
    icons={STEP_ICONS}
    onselect={pickStep}
    onclose={() => (picker = null)}
  />
{:else if picker?.kind === 'trigger'}
  <StepPicker groups={TRIGGER_MENU} label="Add a trigger" anchor={picker.anchor} icons={TRIGGER_ICONS} onselect={pickTrigger} onclose={() => (picker = null)} />
{/if}

{#if picker?.at && picker.link}
  {@const r = rects.get(picker.link.from)}
  {#if r}
    {@const a = toScreenPt(anchor(r, picker.link.side))}
    {@const b = toScreenPt(picker.at)}
    <svg class="pending" aria-hidden="true" style="left:{viewport?.getBoundingClientRect().left ?? 0}px;top:{viewport?.getBoundingClientRect().top ?? 0}px">
      <path d={pathOf(curve(a, picker.link.side, b, OPPOSITE[picker.link.side]))} />
      <circle cx={b.x} cy={b.y} r="4" />
    </svg>
  {/if}
{/if}

<style>
  .flow {
    --node-w: 280px;
    --line: color-mix(in srgb, var(--text-faint) 70%, var(--border));
    display: flex;
    flex: 1;
    min-height: 0;
    min-width: 0;
  }
  .canvas-wrap {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    container-type: inline-size;
  }
  .canvas {
    position: relative;
    flex: 1;
    overflow: hidden;
    touch-action: none;
    background-color: var(--bg-0);
    background-image: radial-gradient(circle, color-mix(in srgb, var(--border-strong) 75%, transparent) 1px, transparent 1.3px);
  }
  .canvas:focus-visible {
    outline: none;
  }
  .world {
    position: absolute;
    left: 0;
    top: 0;
    width: 0;
    height: 0;
    transform-origin: 0 0;
  }
  .gn {
    position: absolute;
    width: var(--node-w);
  }
  .gn.lifted {
    z-index: 3;
    filter: drop-shadow(0 10px 18px rgb(0 0 0 / 0.25));
  }

  /* Lines */
  .edges {
    position: absolute;
    left: 0;
    top: 0;
    overflow: visible;
    pointer-events: none;
  }
  .edge {
    --c: var(--line);
    cursor: pointer;
  }
  .edge.if.b-then {
    --c: color-mix(in srgb, var(--ok) 80%, var(--line));
  }
  .edge.if.b-otherwise {
    --c: color-mix(in srgb, var(--warn) 75%, var(--line));
  }
  .edge.ran {
    --c: var(--accent);
  }
  .edge.ran .line {
    stroke-width: 3;
  }
  .edge:hover {
    --c: var(--text-muted);
  }
  .edge.selected {
    --c: var(--accent);
  }
  .hit {
    fill: none;
    stroke: transparent;
    stroke-width: 14;
    pointer-events: stroke;
  }
  .line {
    fill: none;
    stroke: var(--c);
    stroke-width: 2;
    stroke-linecap: round;
    transition: stroke 0.12s;
  }
  .edge:hover .line,
  .edge.selected .line {
    stroke-width: 2.5;
  }
  .edge.selected .line {
    filter: drop-shadow(0 0 4px color-mix(in srgb, var(--accent) 60%, transparent));
  }
  .spark {
    fill: none;
    stroke: var(--on-accent);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-dasharray: 2 10;
    animation: march 0.5s linear infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .spark {
      display: none;
    }
  }
  :global(:root[data-reduce-motion='true']) .spark {
    display: none;
  }
  .head {
    fill: var(--c);
    transition: fill 0.12s;
  }
  .draft {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-dasharray: 6 5;
    animation: march 0.6s linear infinite;
  }
  @keyframes march {
    to {
      stroke-dashoffset: -11;
    }
  }
  .bchip {
    position: absolute;
    z-index: 1;
    transform: translate(-50%, -50%);
    height: 20px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-1);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
    color: var(--text-muted);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.15);
  }
  .bchip.b-then {
    color: var(--ok);
    border-color: color-mix(in srgb, var(--ok) 40%, var(--border));
  }
  .bchip.b-otherwise {
    color: var(--warn);
    border-color: color-mix(in srgb, var(--warn) 40%, var(--border));
  }
  .bchip:hover {
    background: var(--bg-3);
  }
  .bchip.selected {
    border-color: var(--accent);
  }
  .marquee {
    position: absolute;
    border: 1px solid var(--accent);
    border-radius: 3px;
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    pointer-events: none;
  }
  .pending {
    position: fixed;
    z-index: 55;
    width: 1px;
    height: 1px;
    overflow: visible;
    pointer-events: none;
  }
  .pending path {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-dasharray: 6 5;
  }
  .pending circle {
    fill: var(--accent);
  }

  /* Empty flow */
  .empty {
    position: absolute;
    left: 50%;
    top: 42%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    width: 340px;
    padding: 22px 24px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--bg-1) 90%, transparent);
    text-align: center;
  }
  .empty-ic {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    margin-bottom: 4px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent-text);
  }
  .empty-title {
    font-size: 14px;
    font-weight: 650;
  }
  .empty-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    margin: 8px 0 2px;
    padding: 0 14px;
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }
  .small {
    font-size: 12px;
  }

  /* Overlays on the canvas */
  .runbar {
    position: absolute;
    top: 12px;
    left: 14px;
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: calc(100% - 340px);
  }
  .runbar.replay {
    gap: 2px;
    height: 34px;
    padding: 0 4px 0 12px;
    border: 1px solid var(--accent);
    border-radius: 10px;
    background: color-mix(in srgb, var(--bg-1) 94%, transparent);
    backdrop-filter: blur(8px);
    box-shadow: var(--shadow-pop);
    font-size: 12px;
  }
  .replay .label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-right: 6px;
    font-weight: 600;
    white-space: nowrap;
  }
  .replay .dot,
  .runchip .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ok);
  }
  .replay .dot.bad {
    background: var(--danger);
  }
  .stepno {
    min-width: 76px;
    text-align: center;
    font-size: 11.5px;
    white-space: nowrap;
    color: var(--text-muted);
  }
  .cur {
    min-width: 0;
    max-width: 180px;
    margin: 0 6px;
    color: var(--text);
  }
  .live {
    flex: none;
    height: 26px;
    margin-left: 4px;
    padding: 0 10px;
    border-radius: 7px;
    font-weight: 600;
    background: var(--accent);
    color: var(--on-accent);
  }
  .live:hover {
    background: var(--accent-hover);
  }
  .runs {
    display: inline-flex;
  }
  .runs :global(button[aria-haspopup]) {
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg-1) 92%, transparent);
    backdrop-filter: blur(6px);
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.12);
    color: var(--text);
  }
  .runs :global(button[aria-haspopup]:hover),
  .runs :global(button[aria-haspopup][aria-expanded='true']) {
    background: var(--bg-3);
  }
  .runchip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg-1) 92%, transparent);
    backdrop-filter: blur(6px);
    font-size: 12px;
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.12);
  }
  .runchip.bad .dot {
    background: var(--danger);
  }
  .spin {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid var(--accent);
    border-right-color: transparent;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .tools {
    position: absolute;
    right: 14px;
    top: 12px;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: color-mix(in srgb, var(--bg-1) 94%, transparent);
    backdrop-filter: blur(8px);
    box-shadow: var(--shadow-pop);
  }
  .tool {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 9px;
    border-radius: 7px;
    font-size: 12px;
    font-weight: 550;
    color: var(--text-muted);
  }
  .tool:hover:not(:disabled) {
    background: var(--bg-3);
    color: var(--text);
  }
  .tool:disabled {
    opacity: 0.5;
  }
  .tool.on {
    color: var(--accent-text);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .sep {
    width: 1px;
    height: 18px;
    margin: 0 4px;
    background: var(--border);
  }
  .pct {
    min-width: 46px;
    height: 24px;
    font-size: 11.5px;
    color: var(--text-muted);
    border-radius: 6px;
  }
  .pct:hover {
    background: var(--bg-3);
  }
  .palette {
    position: absolute;
    left: 50%;
    bottom: 14px;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 2px;
    max-width: calc(100% - 28px);
    overflow-x: auto;
    padding: 5px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: color-mix(in srgb, var(--bg-1) 94%, transparent);
    backdrop-filter: blur(8px);
    box-shadow: var(--shadow-pop);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 550;
    white-space: nowrap;
    color: var(--text-muted);
  }
  .chip:hover {
    background: var(--bg-3);
    color: var(--text);
  }
  .chip.trig {
    color: var(--accent-text);
  }
  .chip.note :global(svg) {
    color: #e2b93b;
  }
  .chip.trig:hover {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
  }
  .psep {
    width: 1px;
    height: 18px;
    margin: 0 4px;
    background: var(--border);
  }
  .hint {
    position: absolute;
    left: 16px;
    bottom: 20px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 11.5px;
    pointer-events: none;
  }
  .hint kbd {
    padding: 0 4px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 10.5px;
  }
  .map {
    position: absolute;
    right: 14px;
    bottom: 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: color-mix(in srgb, var(--bg-1) 94%, transparent);
    backdrop-filter: blur(8px);
    box-shadow: var(--shadow-pop);
  }
  .stats {
    padding: 0 2px;
    font-size: 11px;
  }
  .inspector {
    flex: none;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-1);
  }
  /* Narrower canvas: icons only in the bar, no key hints, smaller overview. */
  @container (max-width: 1180px) {
    .hint {
      display: none;
    }
  }
  @container (max-width: 980px) {
    .palette .chip {
      padding: 0 9px;
    }
    .palette .chip span {
      display: none;
    }
    .tool span {
      display: none;
    }
  }
  @container (max-width: 760px) {
    .map {
      display: none;
    }
  }
</style>
