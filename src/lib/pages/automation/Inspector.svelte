<script lang="ts">
  import type { Action } from '$lib/bindings/Action';
  import IconButton from '$lib/ui/IconButton.svelte';
  import { Copy, Trash2, X } from '@lucide/svelte';
  import { tokensForAction } from './describe';
  import { nodeById } from './graph';
  import StepCard from './StepCard.svelte';
  import { actionsEditor as ed } from './store.svelte';
  import TriggerCard from './TriggerCard.svelte';
  import { provideVarHover } from '$lib/vars/hover';
  import { varInspector as vi } from '$lib/vars/inspector.svelte';
  import { problemText } from '$lib/vars/text';

  interface Props {
    action: Action;
    nodeId: string;
    onclose: () => void;
    onduplicate: () => void;
    ondelete: () => void;
  }

  let { action, nodeId, onclose, onduplicate, ondelete }: Props = $props();

  const node = $derived(nodeById(action.graph, nodeId));
  const issues = $derived((ed.issues[action.id] ?? []).filter((i) => i.key === `node.${nodeId}`));
  const tokens = $derived(tokensForAction(action));
  const patch = (p: Record<string, unknown>) => ed.patchNode(action.id, nodeId, p);

  provideVarHover({
    card(key) {
      let k: string | null = key;
      while (k && !vi.usage.has(k)) k = k.includes('.') ? k.slice(0, k.lastIndexOf('.')) : null;
      const info = k ? vi.info(k) : null;
      return info && { key: info.key, value: info.value, exists: info.exists, usedIn: info.usedIn, problem: problemText(info.problem) };
    },
    open: (key) => (vi.details = key)
  });
</script>

<aside class="insp" aria-label="Inspector">
  <header>
    <span class="eyebrow">{node?.kind.type === 'trigger' ? 'Trigger' : 'Step'}</span>
    <div class="grow"></div>
    <IconButton size="sm" label="Duplicate (Ctrl+D)" onclick={onduplicate}><Copy /></IconButton>
    <IconButton size="sm" label="Delete (Del)" tone="danger" onclick={ondelete}><Trash2 /></IconButton>
    <span class="sep" aria-hidden="true"></span>
    <IconButton size="sm" label="Close inspector (Esc)" onclick={onclose}><X /></IconButton>
  </header>
  <div class="body">
    {#if node?.kind.type === 'trigger'}
      {#key nodeId}
        <TriggerCard t={node.kind.trigger} {action} {issues} onpatch={patch} />
      {/key}
    {:else if node?.kind.type === 'step'}
      {#key nodeId}
        <StepCard step={node.kind.step} {nodeId} {action} {tokens} {issues} onpatch={patch} />
      {/key}
    {/if}
    <p class="keys faint">
      <kbd>Del</kbd> delete · <kbd>Ctrl</kbd>+<kbd>D</kbd> duplicate · <kbd>Esc</kbd> close
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
    gap: 4px;
    height: 42px;
    flex: none;
    padding: 0 8px 0 14px;
    border-bottom: 1px solid var(--border);
  }
  .sep {
    width: 1px;
    height: 18px;
    margin: 0 4px;
    background: var(--border);
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
