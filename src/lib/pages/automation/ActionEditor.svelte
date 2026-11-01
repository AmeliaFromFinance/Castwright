<script lang="ts">
  import { api } from '$lib/api';
  import type { Action } from '$lib/bindings/Action';
  import type { Step } from '$lib/bindings/Step';
import type { Trigger } from '$lib/bindings/Trigger';
  import Menu from '$lib/editors/Menu.svelte';
  import { attempt } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import { Copy, Play, Plus, Trash2 } from '@lucide/svelte';
  import { TRIGGER_MENU, newTrigger } from './defaults';
  import { tokensForAction } from './describe';
  import type { StepOps } from './ops';
  import StepList from './StepList.svelte';
  import { actionsEditor as ed } from './store.svelte';
  import TriggerCard from './TriggerCard.svelte';
  import { duplicateStep, getList, insertStep, moveStep, removeStep, replaceStep, type ListPath } from './tree';

  interface Props {
    action: Action;
    onduplicate: () => void;
    ondelete: () => void;
  }

  let { action, onduplicate, ondelete }: Props = $props();

  const issues = $derived(ed.issues[action.id] ?? []);
  const tokens = $derived(tokensForAction(action));
  const groups = $derived([...new Set((ed.actions ?? []).map((a) => a.group).filter((g) => g.trim()))].sort());
  const nameIssue = $derived(issues.find((i) => i.key === 'name'));

  const apply = (fn: (steps: Step[]) => Step[]) => ed.updateSteps(action.id, fn);
  const patch = (p: Partial<Action>) => ed.patchAction(action.id, p);

  const ops: StepOps = {
    insert: (path: ListPath, i: number, s: Step) => apply((st) => insertStep(st, path, i, s)),
    remove: (path: ListPath, i: number) => apply((st) => removeStep(st, path, i)),
    move: (path: ListPath, i: number, by: number) => apply((st) => moveStep(st, path, i, by)),
    duplicate: (path: ListPath, i: number) => apply((st) => duplicateStep(st, path, i)),
    patch: (path: ListPath, i: number, p: Record<string, unknown>) =>
      apply((st) => {
        const cur = getList(st, path)?.[i];
        return cur ? replaceStep(st, path, i, { ...cur, ...p } as Step) : st;
      })
  };
</script>

<div class="editor">
  <div class="head">
    <div class="f name">
      <label for="act-name" class="sr-only">Action name</label>
      <input
        id="act-name"
        class="input title"
        placeholder="Action name"
        aria-invalid={nameIssue ? 'true' : undefined}
        value={action.name}
        oninput={(e) => {
          patch({ name: e.currentTarget.value });
        }}
      />
      {#if nameIssue}<p class="error" role="alert">{nameIssue.message}</p>{/if}
    </div>
    <Switch
      label="Enabled"
      showLabel
      checked={action.enabled}
      onchange={(v) => patch({ enabled: v })}
    />
    <Button size="sm" onclick={() => attempt(() => api.runAction(action.id))} title="Run the steps now, ignoring triggers and cooldown">
      <Play size={13} />Run now
    </Button>
    <IconButton label="Duplicate action" onclick={onduplicate}><Copy /></IconButton>
    <IconButton label="Delete action" tone="danger" onclick={ondelete}><Trash2 /></IconButton>
  </div>

  <div class="meta">
    <div class="f">
      <label for="act-group">Group</label>
      <input
        id="act-group"
        class="input"
        list="act-groups"
        placeholder="General"
        value={action.group}
        onchange={(e) => {
          patch({ group: e.currentTarget.value.trim() || 'General' });
        }}
      />
      <datalist id="act-groups">
        {#each groups as g (g)}<option value={g}></option>{/each}
      </datalist>
    </div>
    <div class="f">
      <label for="act-cd">Cooldown (seconds)</label>
      <input
        id="act-cd"
        class="input"
        type="number"
        min="0"
        value={action.cooldown_s}
        oninput={(e) => {
          const n = Math.round(Number(e.currentTarget.value));
          if (e.currentTarget.value.trim() !== '' && Number.isFinite(n)) {
            patch({ cooldown_s: Math.max(0, Math.min(86_400, n)) });
          }
        }}
      />
    </div>
    <p class="hint">Cooldown is the shortest time between two runs. 0 means no limit.</p>
  </div>

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
        <p class="empty faint">No triggers. The action only runs from Run now or another action.</p>
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
  }
  .head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }
  .head > :global(*) {
    margin-top: 3px;
  }
  .head .name {
    flex: 1;
    margin-top: 0;
  }
  .title {
    height: 38px;
    font-size: 16px;
    font-weight: 650;
  }
  .meta {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 180px minmax(0, 1fr);
    gap: 10px;
    align-items: end;
  }
  .f {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .f > label {
    font-size: 12px;
    font-weight: 550;
    color: var(--text-muted);
  }
  .hint {
    font-size: 12px;
    color: var(--text-faint);
    padding-bottom: 8px;
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
  .error {
    font-size: 12px;
    color: var(--danger);
  }
</style>
