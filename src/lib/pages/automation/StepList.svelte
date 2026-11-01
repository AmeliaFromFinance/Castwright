<script lang="ts">
  import type { Action } from '$lib/bindings/Action';
  import type { Step } from '$lib/bindings/Step';
  import type { Token } from '$lib/editors/tokens';
  import Menu from '$lib/editors/Menu.svelte';
  import { Plus } from '@lucide/svelte';
  import { STEP_MENU, newStep } from './defaults';
  import type { StepOps } from './ops';
  import StepCard from './StepCard.svelte';
  import type { ListPath } from './tree';
  import type { Issue } from './validate';

  interface Props {
    steps: Step[];
    path: ListPath;
    action: Action;
    ops: StepOps;
    tokens: Token[];
    issues: Issue[];
    /** Text for the add button. */
    addLabel?: string;
    emptyText?: string;
  }

  let { steps, path, action, ops, tokens, issues, addLabel = 'Add step', emptyText = 'No steps yet.' }: Props = $props();
</script>

<ol class="steps" class:nested={path.length > 0}>
  {#each steps as step, i (i)}
    <li>
      <StepCard {step} {path} index={i} count={steps.length} {action} {ops} {tokens} {issues} />
    </li>
  {:else}
    <li class="none faint">{emptyText}</li>
  {/each}
  <li class="add">
    <Menu groups={STEP_MENU} label={addLabel} variant="ghost" onselect={(type) => ops.insert(path, steps.length, newStep(type))}>
      <Plus size={14} />{addLabel}
    </Menu>
  </li>
</ol>

<style>
  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .none {
    font-size: 12px;
    padding: 4px 2px;
  }
  .add {
    padding-top: 2px;
  }
</style>
