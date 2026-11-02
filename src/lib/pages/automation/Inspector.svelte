<script lang="ts">
  import type { Action } from '$lib/bindings/Action';
  import Menu from '$lib/editors/Menu.svelte';
  import type { MenuGroup } from '$lib/editors/menu';
  import IconButton from '$lib/ui/IconButton.svelte';
  import { ArrowRightLeft, X } from '@lucide/svelte';
  import { tokensForAction } from './describe';
  import { stepOps } from './ops';
  import StepCard from './StepCard.svelte';
  import { actionsEditor as ed } from './store.svelte';
  import { allLists, getList, isInside, parseStepKey, samePath, type StepAt } from './tree';
  import TriggerCard from './TriggerCard.svelte';

  interface Props {
    action: Action;
    nodeKey: string;
    onclose: () => void;
    onmove: (from: StepAt, to: StepAt) => void;
    ondelete: () => void;
  }

  let { action, nodeKey, onclose, onmove, ondelete }: Props = $props();

  const ops = stepOps(() => action.id);
  const issues = $derived(ed.issues[action.id] ?? []);
  const tokens = $derived(tokensForAction(action));
  const trigger = $derived(nodeKey.startsWith('t.') ? Number(nodeKey.slice(2)) : null);
  const at = $derived(nodeKey.startsWith('s.') ? parseStepKey(nodeKey.slice(2)) : null);
  const list = $derived(at ? getList(action.steps, at.path) : null);
  const step = $derived(at && list ? list[at.index] : undefined);

  // Lists this step can move to: not its own branches, not where it already is.
  const targets = $derived(at ? allLists(action.steps).filter((l) => !isInside(l.path, at.path, at.index) && !samePath(l.path, at.path)) : []);
  const moveMenu = $derived<MenuGroup<string>[]>([{ label: 'Move to the end of', items: targets.map((l, i) => ({ value: String(i), label: l.label })) }]);
</script>

<aside class="insp" aria-label="Inspector">
  <header>
    <span class="eyebrow">{trigger !== null ? 'Trigger' : 'Step'}</span>
    <div class="grow"></div>
    {#if at && targets.length}
      <Menu
        groups={moveMenu}
        label="Move to"
        variant="ghost"
        align="right"
        onselect={(v) => {
          const t = targets[Number(v)];
          if (t) onmove(at, { path: t.path, index: getList(action.steps, t.path)?.length ?? 0 });
        }}
      >
        <ArrowRightLeft size={13} />Move to
      </Menu>
    {/if}
    <IconButton size="sm" label="Close inspector (Esc)" onclick={onclose}><X /></IconButton>
  </header>
  <div class="body">
    {#if trigger !== null && action.triggers[trigger]}
      {@const i = trigger}
      <TriggerCard
        t={action.triggers[i]!}
        {action}
        issues={issues.filter((x) => x.key === `trigger.${i}`)}
        onremove={ondelete}
        onpatch={(p) => ed.patchTrigger(action.id, i, p)}
      />
    {:else if at && step && list}
      {#key nodeKey}
        <StepCard {step} path={at.path} index={at.index} count={list.length} {action} {ops} {tokens} {issues} inspector />
      {/key}
    {/if}
    <p class="keys faint">
      <kbd>Del</kbd> delete · <kbd>Ctrl</kbd>+<kbd>D</kbd> duplicate · <kbd>Alt</kbd>+<kbd>↑</kbd><kbd>↓</kbd> reorder · <kbd>Esc</kbd> close
    </p>
  </div>
</aside>

<style>
  .insp {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  header {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 42px;
    flex: none;
    padding: 0 8px 0 14px;
    border-bottom: 1px solid var(--border);
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
  }
  /* The forms sit straight in the panel, no card around them. */
  .body > :global(.step),
  .body > :global(.trigger) {
    border: 0;
    background: none;
  }
  .body > :global(.trigger) {
    padding: 0;
  }
  .body > :global(.step > header) {
    padding: 0 0 8px;
    height: auto;
  }
  .body > :global(.step > .fields) {
    padding: 10px 0 0;
  }
  .keys {
    font-size: 11.5px;
    line-height: 1.8;
  }
  kbd {
    padding: 0 4px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-muted);
  }
</style>
