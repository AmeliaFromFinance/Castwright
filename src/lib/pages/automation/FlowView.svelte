<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Action } from '$lib/bindings/Action';
  import type { Permission } from '$lib/bindings/Permission';
  import type { Step } from '$lib/bindings/Step';
  import type { Trigger } from '$lib/bindings/Trigger';
  import { describeConditions } from '$lib/editors/conditions';
  import { clone } from '$lib/editors/ids';
  import type { MenuGroup } from '$lib/editors/menu';
  import { isTypingTarget } from '$lib/editor/keys';
  import { app } from '$lib/state/app.svelte';
  import { toasts } from '$lib/state/toast.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import ResizeHandle from '$lib/ui/ResizeHandle.svelte';
  import { Maximize, Minus, Plus } from '@lucide/svelte';
  import { STEP_GROUPS, STEP_LABELS, STEP_MENU, TRIGGER_LABELS, TRIGGER_MENU, newStep, newTrigger, type StepType, type TriggerType } from './defaults';
  import { describeStep, describeTrigger, every, tokensForAction } from './describe';
  import { layoutFlow, neighbour, nodeKey, triggerKey, type Direction, type FlowCell, type NodeCell } from './flow';
  import FlowNode from './FlowNode.svelte';
  import { GROUP_ICONS, STEP_ICONS, TRIGGER_ICONS, stepTone } from './icons';
  import Inspector from './Inspector.svelte';
  import { runStatus } from './runstatus';
  import StepPicker from './StepPicker.svelte';
  import { actionsEditor as ed, flow, runLog } from './store.svelte';
  import { duplicateStep, getList, insertStep, isInside, moveStep, moveStepTo, parseStepKey, removeStep, stepKey, type ListPath, type StepAt } from './tree';

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

  let scroller: HTMLDivElement | undefined = $state();
  let stage: HTMLDivElement | undefined = $state();
  let root: HTMLDivElement | undefined = $state();
  let inspectorW = $state(440);

  const layout = $derived(layoutFlow(action.steps, action.triggers.length));
  const issues = $derived(ed.issues[action.id] ?? []);
  const ctx = $derived({ actions: ed.actions ?? [], overlays: app.project?.overlays ?? [] });

  // Results of the latest run; after a new run they appear node by node.
  const lastRun = $derived(runLog.last[action.id]);
  const status = $derived(lastRun ? runStatus(action, lastRun) : {});
  const running = $derived(flow.testing?.actionId === action.id);
  const order = $derived([...action.triggers.map((_, i) => triggerKey(i)), ...layout.nodes.map((n) => n.key)]);
  let revealed = $state(Infinity);
  let seenSeq = -1;

  $effect(() => {
    const seq = lastRun?.seq ?? 0;
    if (seenSeq === -1 || seq === seenSeq) {
      seenSeq = seq;
      return;
    }
    seenSeq = seq;
    revealed = 0;
    const timer = setInterval(() => {
      revealed++;
      if (revealed >= order.length) {
        revealed = Infinity;
        clearInterval(timer);
      }
    }, 70);
    return () => clearInterval(timer);
  });

  const statusOf = (key: string) => (order.indexOf(key) < revealed ? status[key] : undefined);

  // Drop the selection when its node is gone (after undo, for example).
  $effect(() => {
    const k = flow.selected;
    if (k && !order.includes(k)) flow.select(null);
  });

  // Dragging

  let dragging = $state<StepAt | null>(null);
  let over = $state<string | null>(null);

  /** A step can't be dropped into its own branches. */
  const canDrop = (path: ListPath) => !!dragging && !isInside(path, dragging.path, dragging.index);

  function dropTo(to: StepAt) {
    const from = dragging;
    dragging = null;
    over = null;
    if (!from) return;
    moveTo(from, to);
  }

  function moveTo(from: StepAt, to: StepAt) {
    let at: StepAt | null = null;
    ed.updateSteps(action.id, (st) => {
      const r = moveStepTo(st, from, to);
      at = r?.at ?? null;
      return r?.steps ?? st;
    });
    if (at) flow.select(nodeKey((at as StepAt).path, (at as StepAt).index));
  }

  // Editing

  function insertAt(path: ListPath, index: number, step: Step) {
    ed.updateSteps(action.id, (st) => insertStep(st, path, index, step));
    flow.select(nodeKey(path, index), true);
    void focusNode(nodeKey(path, index));
  }

  function removeNode(key: string) {
    if (key.startsWith('t.')) {
      const i = Number(key.slice(2));
      ed.patchAction(action.id, { triggers: (clone($state.snapshot(action.triggers)) as Trigger[]).filter((_, j) => j !== i) });
      flow.select(null);
      toasts.show('Trigger removed. Ctrl+Z brings it back.');
      return;
    }
    const at = parseStepKey(key.slice(2));
    if (!at) return;
    ed.updateSteps(action.id, (st) => removeStep(st, at.path, at.index));
    // Select the step that took its place, the one before, or the if it was in.
    const left = getList(action.steps, at.path)?.length ?? 0;
    const parent = at.path[at.path.length - 1];
    flow.select(
      at.index < left
        ? key
        : at.index > 0
          ? nodeKey(at.path, at.index - 1)
          : parent
            ? nodeKey(at.path.slice(0, -1), parent.index)
            : null
    );
    toasts.show('Step deleted. Ctrl+Z brings it back.');
  }

  function duplicateNode(key: string) {
    if (key.startsWith('t.')) {
      const i = Number(key.slice(2));
      const t = action.triggers[i];
      if (!t) return;
      const list = clone($state.snapshot(action.triggers)) as Trigger[];
      list.splice(i + 1, 0, clone($state.snapshot(t)) as Trigger);
      ed.patchAction(action.id, { triggers: list });
      flow.select(triggerKey(i + 1));
      return;
    }
    const at = parseStepKey(key.slice(2));
    if (!at) return;
    ed.updateSteps(action.id, (st) => duplicateStep(st, at.path, at.index));
    flow.select(nodeKey(at.path, at.index + 1));
  }

  function addTrigger(type: TriggerType) {
    ed.patchAction(action.id, { triggers: [...(clone($state.snapshot(action.triggers)) as Trigger[]), newTrigger(type)] });
    flow.select(triggerKey(action.triggers.length - 1), true);
  }

  /** Where new and pasted steps go: after the selected step, else at the end. */
  function insertPoint(): StepAt {
    const at = flow.selected?.startsWith('s.') ? parseStepKey(flow.selected.slice(2)) : null;
    if (at) return { path: at.path, index: at.index + 1 };
    if (flow.selected?.startsWith('t.')) return { path: [], index: 0 };
    return { path: [], index: action.steps.length };
  }

  // Picker for new steps and triggers

  type PickFor = { kind: 'step'; at: StepAt; group?: string } | { kind: 'trigger' };
  let picker = $state<(PickFor & { anchor: DOMRect }) | null>(null);

  function openPicker(e: MouseEvent, p: PickFor) {
    picker = { ...p, anchor: (e.currentTarget as HTMLElement).getBoundingClientRect() };
  }

  const stepGroups = $derived(
    picker?.kind === 'step' && picker.group ? STEP_MENU.filter((g) => g.label === (picker as { group?: string }).group) : STEP_MENU
  );

  // Zoom

  async function zoomTo(z: number, cx?: number, cy?: number) {
    if (!scroller) return;
    const r = scroller.getBoundingClientRect();
    const mx = cx ?? r.width / 2;
    const my = cy ?? r.height / 2;
    const old = flow.zoom;
    const px = (scroller.scrollLeft + mx) / old;
    const py = (scroller.scrollTop + my) / old;
    flow.setZoom(z);
    await tick();
    scroller.scrollLeft = px * flow.zoom - mx;
    scroller.scrollTop = py * flow.zoom - my;
  }

  function fit() {
    if (!scroller || !stage) return;
    const r = stage.getBoundingClientRect();
    const w = r.width / flow.zoom;
    const h = r.height / flow.zoom;
    const z = Math.min(1, scroller.clientWidth / w, (scroller.clientHeight - 56) / h);
    flow.setZoom(Math.max(0.3, Math.floor(z * 20) / 20));
    void tick().then(() => scroller?.scrollTo({ left: 0, top: 0 }));
  }

  onMount(() => {
    const el = scroller!;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      void zoomTo(flow.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });

  // Keyboard

  async function focusNode(key: string) {
    await tick();
    root?.querySelector<HTMLElement>(`[data-node="${key}"]`)?.focus();
  }

  function selectAndFocus(key: string | null) {
    if (!key) return;
    flow.select(key);
    void focusNode(key);
  }

  function inScope(e: KeyboardEvent): boolean {
    if (e.defaultPrevented || isTypingTarget(e.target) || picker) return false;
    const t = e.target as Element | null;
    if (!t || t === document.body) return true;
    if (!root?.contains(t)) return false;
    // Keep keys for controls that use them.
    return !t.closest('[role="radiogroup"], [role="separator"], [role="menu"], [role="dialog"], select');
  }

  function onKey(e: KeyboardEvent) {
    // Escape closes the inspector from anywhere on the page, except in fields and popups.
    if (e.key === 'Escape' && flow.inspecting && !e.defaultPrevented && !isTypingTarget(e.target) && !picker) {
      const t = e.target as Element | null;
      if (!t?.closest?.('[role="menu"], [role="dialog"]')) {
        flow.inspecting = false;
        if (flow.selected) void focusNode(flow.selected);
        e.preventDefault();
        return;
      }
    }
    if (!inScope(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const sel = flow.selected;
    const at = sel?.startsWith('s.') ? parseStepKey(sel.slice(2)) : null;
    const arrows: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

    if (mod && !e.altKey) {
      if (key === 'd' && sel) duplicateNode(sel);
      else if (key === 'c' && at) {
        flow.clipboard = clone($state.snapshot(getList(action.steps, at.path)![at.index]!)) as Step;
        toasts.show('Step copied');
      } else if (key === 'x' && at && sel) {
        flow.clipboard = clone($state.snapshot(getList(action.steps, at.path)![at.index]!)) as Step;
        removeNode(sel);
      } else if (key === 'v' && flow.clipboard) {
        const p = insertPoint();
        insertAt(p.path, p.index, clone(flow.clipboard));
      } else return;
      e.preventDefault();
      return;
    }
    if (e.altKey && at && (key === 'ArrowUp' || key === 'ArrowDown')) {
      const by = key === 'ArrowUp' ? -1 : 1;
      const len = getList(action.steps, at.path)?.length ?? 0;
      if (at.index + by >= 0 && at.index + by < len) {
        ed.updateSteps(action.id, (st) => moveStep(st, at.path, at.index, by));
        selectAndFocus(nodeKey(at.path, at.index + by));
      }
      e.preventDefault();
      return;
    }
    if (e.altKey || mod) return;
    if (arrows[key]) {
      const first = order[0] ?? null;
      selectAndFocus(sel ? neighbour(layout, action.triggers.length, sel, arrows[key]!) : first);
    } else if ((key === 'Delete' || key === 'Backspace') && sel) {
      removeNode(sel);
      if (flow.selected) void focusNode(flow.selected);
    } else if (key === 'Enter' && sel && !(e.target as Element)?.closest?.('button')) {
      flow.select(sel, true);
    } else if (key === 'Escape') {
      if (flow.inspecting) {
        flow.inspecting = false;
        if (sel) void focusNode(sel);
      } else flow.select(null);
    } else return;
    e.preventDefault();
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

  const nodeIssues = (key: string) => issues.filter((i) => i.key === (key.startsWith('t.') ? `trigger.${key.slice(2)}` : `step.${key.slice(2)}`));

  function cellStyle(c: FlowCell): string {
    const rows = c.kind === 'rail' ? `${c.row + 1} / ${c.rowEnd + 1}` : `${c.row + 1}`;
    return `grid-row:${rows};grid-column:${c.col + 1} / span ${c.span}`;
  }

  const forkStyle = (c: { span: number; then: number }) => `--a:${(c.then / 2 / c.span) * 100}%;--b:${((c.then + (c.span - c.then) / 2) / c.span) * 100}%`;

  const laneLabel = (path: ListPath) => {
    const last = path[path.length - 1];
    return !last ? 'Add step' : last.branch === 'then' ? 'Add to Then' : 'Add to Otherwise';
  };
</script>

<svelte:window onkeydown={onKey} />

{#snippet gap(path: ListPath, index: number, label: string)}
  {@const id = `${stepKey(path, index)}`}
  {@const ok = canDrop(path)}
  <div
    class="gap"
    class:droppable={dragging && ok}
    class:over={over === id && ok}
    role="presentation"
    ondragover={(e) => {
      if (!ok) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      over = id;
    }}
    ondragleave={() => {
      if (over === id) over = null;
    }}
    ondrop={(e) => {
      e.preventDefault();
      dropTo({ path, index });
    }}
  >
    <button type="button" class="ins" aria-label={label} title={label} onclick={(e) => openPicker(e, { kind: 'step', at: { path, index } })}>
      <Plus size={12} strokeWidth={2.5} />
    </button>
  </div>
{/snippet}

{#snippet stepNode(c: NodeCell)}
  {@const s = c.step}
  <FlowNode
    id={c.key}
    icon={STEP_ICONS[s.type]}
    tone={stepTone(s.type)}
    title={s.type === 'if' ? 'If' : STEP_LABELS[s.type]}
    summary={describeStep(s, ctx)}
    number={c.number}
    issues={nodeIssues(c.key)}
    status={statusOf(c.key)}
    running={running}
    selected={flow.selected === c.key}
    dragging={dragging !== null && nodeKey(dragging.path, dragging.index) === c.key}
    draggable
    onselect={() => flow.select(c.key, true)}
    onduplicate={() => duplicateNode(c.key)}
    ondelete={() => removeNode(c.key)}
    ondragstart={(e) => {
      dragging = { path: c.path, index: c.index };
      e.dataTransfer?.setData('text/plain', c.key);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    }}
    ondragend={() => {
      dragging = null;
      over = null;
    }}
  />
{/snippet}

<div class="flow" bind:this={root}>
  <div class="canvas-wrap">
    <div class="canvas" bind:this={scroller} tabindex="-1" role="region" aria-label="Flow of {action.name || 'this action'}">
      <div class="stage" bind:this={stage} style="zoom:{flow.zoom}">
        <div class="grid" style="grid-template-columns:repeat({layout.cols}, var(--col-w))">
          {#each layout.cells as c, ci (ci)}
            {#if c.kind === 'triggers'}
              <div class="triggers" style={cellStyle(c)}>
                <div class="trow" class:fan={action.triggers.length > 1}>
                  {#each action.triggers as t, i (i)}
                    {@const key = triggerKey(i)}
                    <div class="tslot">
                      <FlowNode
                        id={key}
                        icon={TRIGGER_ICONS[t.type]}
                        tone="trigger"
                        title={TRIGGER_LABELS[t.type]}
                        summary={describeTrigger(t)}
                        rows={triggerRows(t)}
                        chips={outputs(t)}
                        issues={nodeIssues(key)}
                        status={statusOf(key)}
                        {running}
                        selected={flow.selected === key}
                        deleteLabel="Remove trigger"
                        onselect={() => flow.select(key, true)}
                        onduplicate={() => duplicateNode(key)}
                        ondelete={() => removeNode(key)}
                      />
                    </div>
                  {:else}
                    <div class="tslot">
                      <div class="no-trigger">
                        <span class="nt-title">No trigger</span>
                        <span class="faint">Runs from Test or another action.</span>
                      </div>
                    </div>
                  {/each}
                  <button type="button" class="add-trigger" aria-label="Add trigger" title="Add trigger" onclick={(e) => openPicker(e, { kind: 'trigger' })}>
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            {:else if c.kind === 'node'}
              <div class="cell" style={cellStyle(c)}>
                {@render gap(c.path, c.index, 'Insert step here')}
                <div
                  class="slot"
                  role="presentation"
                  ondragover={(e) => {
                    if (!canDrop(c.path) || (dragging && nodeKey(dragging.path, dragging.index) === c.key)) return;
                    e.preventDefault();
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    over = stepKey(c.path, e.clientY > r.top + r.height / 2 ? c.index + 1 : c.index);
                  }}
                  ondrop={(e) => {
                    e.preventDefault();
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    dropTo({ path: c.path, index: e.clientY > r.top + r.height / 2 ? c.index + 1 : c.index });
                  }}
                >
                  {@render stepNode(c)}
                </div>
              </div>
            {:else if c.kind === 'end'}
              <div class="cell end" class:lane={c.path.length > 0} class:empty={c.empty} style={cellStyle(c)}>
                {@render gap(c.path, c.index, c.path.length ? `${laneLabel(c.path)} (end)` : 'Add step at the end')}
                <button type="button" class="add" onclick={(e) => openPicker(e, { kind: 'step', at: { path: c.path, index: c.index } })}>
                  <Plus size={13} />{laneLabel(c.path)}
                </button>
                {#if c.path.length === 0}<span class="stop-dot" aria-hidden="true"></span>{/if}
              </div>
            {:else if c.kind === 'split'}
              <div class="fork split" style="{cellStyle(c)};{forkStyle(c)}" aria-hidden="true">
                <span class="lab then" data-text="Then"></span>
                <span class="lab else" data-text="Otherwise"></span>
              </div>
            {:else if c.kind === 'join'}
              <div class="fork join" style="{cellStyle(c)};{forkStyle(c)}" aria-hidden="true"></div>
            {:else if c.kind === 'rail'}
              <div class="rail" style={cellStyle(c)} aria-hidden="true"></div>
            {/if}
          {/each}
        </div>
      </div>
    </div>

    {#if running || lastRun}
      <div class="runchip" class:bad={!running && lastRun && !lastRun.ok} role="status">
        {#if running}
          <span class="spin" aria-hidden="true"></span>Running…
        {:else if lastRun}
          <span class="dot" aria-hidden="true"></span>Last run {lastRun.ok ? 'worked' : `had ${lastRun.errors.length} error${lastRun.errors.length === 1 ? '' : 's'}`}
          <span class="faint mono">{lastRun.duration_ms} ms · {lastRun.trigger}</span>
        {/if}
      </div>
    {/if}

    <div class="palette" role="toolbar" aria-label="Add step">
      <span class="pl faint">Add step</span>
      {#each STEP_GROUPS as g (g.label)}
        {@const Icon = GROUP_ICONS[g.label]}
        <button
          type="button"
          class="chip"
          title={g.label}
          aria-label={g.label}
          onclick={(e) => openPicker(e, { kind: 'step', at: insertPoint(), group: g.label })}
        >
          {#if Icon}<Icon size={14} />{/if}<span>{g.label}</span>
        </button>
      {/each}
    </div>

    <div class="zoom" role="toolbar" aria-label="Zoom">
      <IconButton size="sm" label="Zoom out" onclick={() => zoomTo(flow.zoom / 1.2)}><Minus /></IconButton>
      <button type="button" class="pct mono" title="Reset zoom" onclick={() => zoomTo(1)}>{Math.round(flow.zoom * 100)}%</button>
      <IconButton size="sm" label="Zoom in" onclick={() => zoomTo(flow.zoom * 1.2)}><Plus /></IconButton>
      <IconButton size="sm" label="Zoom to fit" onclick={fit}><Maximize /></IconButton>
    </div>
  </div>

  {#if flow.inspecting && flow.selected}
    <ResizeHandle bind:size={inspectorW} id="automation.inspector" min={340} max={760} initial={440} panel="after" label="Resize inspector" />
    <div class="inspector" style="width:{inspectorW}px">
      <Inspector
        {action}
        nodeKey={flow.selected}
        onclose={() => {
          const k = flow.selected;
          flow.inspecting = false;
          if (k) void focusNode(k);
        }}
        onmove={(from, to) => moveTo(from, to)}
        ondelete={() => flow.selected && removeNode(flow.selected)}
      />
    </div>
  {/if}
</div>

{#if picker?.kind === 'step'}
  {@const at = picker.at}
  <StepPicker
    groups={stepGroups as MenuGroup<StepType>[]}
    label="Add a step"
    anchor={picker.anchor}
    icons={STEP_ICONS}
    onselect={(type) => insertAt(at.path, at.index, newStep(type))}
    onclose={() => (picker = null)}
  />
{:else if picker?.kind === 'trigger'}
  <StepPicker groups={TRIGGER_MENU} label="Add a trigger" anchor={picker.anchor} icons={TRIGGER_ICONS} onselect={addTrigger} onclose={() => (picker = null)} />
{/if}

<style>
  .flow {
    --node-w: 280px;
    --col-w: 332px;
    --line: color-mix(in srgb, var(--text-faint) 55%, var(--border));
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
    flex: 1;
    overflow: auto;
    background-color: var(--bg-0);
    background-image: radial-gradient(circle, color-mix(in srgb, var(--border-strong) 70%, transparent) 1px, transparent 1.2px);
    background-size: 18px 18px;
  }
  .canvas:focus-visible {
    outline: none;
  }
  .stage {
    display: flex;
    justify-content: center;
    min-width: fit-content;
    padding: 56px 48px 120px;
  }
  .grid {
    display: grid;
    grid-auto-rows: auto;
    align-items: stretch;
  }

  /* Triggers */
  .triggers {
    display: flex;
    justify-content: center;
    padding-bottom: 0;
  }
  .trow {
    position: relative;
    display: inline-flex;
    gap: 24px;
    padding-bottom: 14px;
  }
  .trow.fan {
    padding-bottom: 28px;
  }
  .tslot {
    position: relative;
    width: var(--node-w);
  }
  /* Line from each trigger down, joined by a bar when there are several. */
  .tslot::after {
    content: '';
    position: absolute;
    left: calc(50% - 1px);
    top: 100%;
    width: 2px;
    height: 14px;
    background: var(--line);
  }
  .trow::after {
    content: '';
    position: absolute;
    left: calc(50% - 1px);
    bottom: 0;
    width: 2px;
    height: 14px;
    background: var(--line);
  }
  .trow.fan::before {
    content: '';
    position: absolute;
    left: calc(var(--node-w) / 2 - 1px);
    right: calc(var(--node-w) / 2 - 1px);
    bottom: 13px;
    height: 2px;
    border-radius: 2px;
    background: var(--line);
  }
  .no-trigger {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 14px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-lg);
    background: var(--bg-1);
    font-size: 12px;
  }
  .nt-title {
    font-weight: 620;
  }
  .add-trigger {
    position: absolute;
    right: -40px;
    top: 8px;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 1px dashed var(--border-strong);
    color: var(--text-muted);
    background: var(--bg-1);
  }
  .add-trigger:hover {
    border-style: solid;
    border-color: var(--accent);
    color: var(--accent-text);
  }

  /* Steps */
  .cell {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 0;
  }
  .slot {
    width: 100%;
    display: flex;
    justify-content: center;
  }
  .gap {
    position: relative;
    width: 100%;
    height: 40px;
    display: grid;
    place-items: center;
    flex: none;
  }
  .gap::before {
    content: '';
    position: absolute;
    left: calc(50% - 1px);
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--line);
  }
  .ins {
    position: relative;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 1px solid var(--border-strong);
    background: var(--bg-1);
    color: var(--text-faint);
    opacity: 0;
    transform: scale(0.85);
    transition:
      opacity 0.12s,
      transform 0.12s var(--ease);
  }
  .gap:hover .ins,
  .ins:focus-visible {
    opacity: 1;
    transform: none;
  }
  .ins:hover {
    border-color: var(--accent);
    color: var(--accent-text);
  }
  .gap.droppable::after {
    content: '';
    position: absolute;
    left: calc(50% - var(--node-w) / 2);
    width: var(--node-w);
    max-width: 100%;
    top: calc(50% - 2px);
    height: 4px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--accent) 25%, transparent);
  }
  .gap.over::after {
    background: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent);
  }
  .gap.droppable .ins {
    opacity: 0;
  }
  .end {
    padding-bottom: 6px;
  }
  .end.lane::after {
    content: '';
    position: absolute;
    left: calc(50% - 1px);
    top: 40px;
    bottom: 0;
    width: 2px;
    background: var(--line);
  }
  .add {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    padding: 0 12px;
    border: 1px dashed var(--border-strong);
    border-radius: 999px;
    background: var(--bg-1);
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 550;
  }
  .add:hover {
    border-style: solid;
    border-color: var(--accent);
    color: var(--accent-text);
  }
  .end:not(.lane) .add {
    height: 32px;
    padding: 0 16px;
  }
  .stop-dot {
    width: 10px;
    height: 10px;
    margin-top: 14px;
    border-radius: 50%;
    border: 2px solid var(--line);
  }
  .rail {
    position: relative;
  }
  .rail::before {
    content: '';
    position: absolute;
    left: calc(50% - 1px);
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--line);
  }

  /* Where an if splits and joins. --a and --b are the lane centres. */
  .fork {
    position: relative;
  }
  .split {
    height: 46px;
  }
  .join {
    height: 28px;
  }
  .fork::before,
  .fork::after {
    content: '';
    position: absolute;
    background: var(--line);
  }
  .split::before {
    left: var(--a);
    right: calc(100% - var(--b));
    top: 12px;
    height: 2px;
  }
  .split::after {
    left: calc(50% - 1px);
    top: 0;
    width: 2px;
    height: 13px;
  }
  .join::before {
    left: var(--a);
    right: calc(100% - var(--b));
    top: 13px;
    height: 2px;
  }
  .join::after {
    left: calc(50% - 1px);
    top: 14px;
    bottom: 0;
    width: 2px;
  }
  .lab {
    position: absolute;
    top: 12px;
    bottom: 0;
    display: grid;
    place-items: center;
    transform: translateX(-50%);
  }
  .lab::before {
    content: '';
    position: absolute;
    left: calc(50% - 1px);
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--line);
  }
  .lab::after {
    content: attr(data-text);
    position: relative;
    padding: 1px 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-1);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .lab.then {
    left: var(--a);
    color: var(--ok);
  }
  .lab.else {
    left: var(--b);
    color: var(--text-muted);
  }

  /* Overlays on the canvas */
  .runchip {
    position: absolute;
    top: 12px;
    left: 14px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg-1) 92%, transparent);
    backdrop-filter: blur(6px);
    font-size: 12px;
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.12);
  }
  .runchip .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ok);
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
  .palette {
    position: absolute;
    left: 50%;
    bottom: 14px;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: calc(100% - 28px);
    overflow-x: auto;
    padding: 5px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: color-mix(in srgb, var(--bg-1) 94%, transparent);
    backdrop-filter: blur(8px);
    box-shadow: var(--shadow-pop);
  }
  .pl {
    padding: 0 8px 0 6px;
    font-size: 12px;
    white-space: nowrap;
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
  .zoom {
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
    box-shadow: var(--shadow-pop);
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
  .inspector {
    flex: none;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-1);
  }
  /* Narrow canvas: icons only, names in the tooltip. */
  @container (max-width: 860px) {
    .palette .chip {
      padding: 0 9px;
    }
    .palette .chip span {
      display: none;
    }
  }
</style>
