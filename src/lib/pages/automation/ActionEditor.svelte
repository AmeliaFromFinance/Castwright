<script lang="ts">
  import type { Action } from '$lib/bindings/Action';
  import type { Trigger } from '$lib/bindings/Trigger';
  import Menu from '$lib/editors/Menu.svelte';
  import { Plus } from '@lucide/svelte';
  import { TRIGGER_MENU, newTrigger } from './defaults';
  import { tokensForAction } from './describe';
  import StepList from './StepList.svelte';
  import { actionsEditor as ed } from './store.svelte';
  import TriggerCard from './TriggerCard.svelte';
  import { stepOps, type StepOps } from './ops';

  interface Props {
    action: Action;
  }

  let { action }: Props = $props();

  const issues = $derived(ed.issues[action.id] ?? []);
  const tokens = $derived(tokensForAction(action));
  const patch = (p: Partial<Action>) => ed.patchAction(action.id, p);
  const ops: StepOps = stepOps(() => action.id);
</script>

<div class="editor">
  <section aria-labelledby="trg-h">
    <div class="sec-head">
      <h3 id="trg-h" class="eyebrow">Triggers</h3>
      <span class="faint sec-note">Any of these starts the action.</span>
      <div class="grow"></div>
      <Menu
        groups={TRIGGER_MENU}
        label="Add trigger"
        align="right"
        onselect={(type) => patch({ triggers: [...($state.snapshot(action.triggers) as Trigger[]), newTrigger(type)] })}
      >
        <Plus size={14} />Add trigger
      </Menu>
    </div>
    <div class="cards">
      {#each action.triggers as t, i (i)}
        <TriggerCard
          {t}
          {action}
          issues={issues.filter((x) => x.key === `trigger.${i}`)}
          onremove={() => patch({ triggers: action.triggers.filter((_, j) => j !== i) })}
          onpatch={(p) => ed.patchTrigger(action.id, i, p)}
        />
      {:else}
        <p class="empty faint">No triggers. The action only runs from Test or another action.</p>
      {/each}
    </div>
  </section>

  <section aria-labelledby="steps-h">
    <div class="sec-head">
      <h3 id="steps-h" class="eyebrow">Steps</h3>
      <span class="faint sec-note">Run from top to bottom.</span>
    </div>
    <StepList steps={action.steps} path={[]} {action} {ops} {tokens} {issues} emptyText="No steps yet. Add what should happen." />
  </section>
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    gap: 18px;
    max-width: 920px;
    margin: 0 auto;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sec-head {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 28px;
  }
  .sec-note {
    font-size: 12px;
  }
  .cards {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .empty {
    font-size: 12px;
    padding: 2px;
  }
</style>
