<script lang="ts">
  import type { Condition } from '$lib/bindings/Condition';
  import type { ConditionGroup } from '$lib/bindings/ConditionGroup';
  import type { Op } from '$lib/bindings/Op';
  import { parseNumber } from '$lib/logic/condition';
  import IconButton from '$lib/ui/IconButton.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { Plus, X } from '@lucide/svelte';

  interface Props {
    group: ConditionGroup;
    /** Suggested fields for the field box. */
    fields?: Array<{ value: string; label: string }>;
    /** Shown when there are no conditions. */
    emptyText?: string;
    onchange?: (g: ConditionGroup) => void;
  }

  let { group = $bindable(), fields = [], emptyText = 'Always', onchange }: Props = $props();

  const uid = `cond-${Math.random().toString(36).slice(2, 8)}`;

  export const OPS: Array<{ value: Op; label: string; needsValue: boolean }> = [
    { value: 'eq', label: 'is', needsValue: true },
    { value: 'ne', label: 'is not', needsValue: true },
    { value: 'gt', label: 'is more than', needsValue: true },
    { value: 'gte', label: 'is at least', needsValue: true },
    { value: 'lt', label: 'is less than', needsValue: true },
    { value: 'lte', label: 'is at most', needsValue: true },
    { value: 'contains', label: 'contains', needsValue: true },
    { value: 'not_contains', label: "doesn't contain", needsValue: true },
    { value: 'starts_with', label: 'starts with', needsValue: true },
    { value: 'ends_with', label: 'ends with', needsValue: true },
    { value: 'exists', label: 'has a value', needsValue: false },
    { value: 'not_exists', label: 'is empty', needsValue: false },
    { value: 'is_true', label: 'is yes/true', needsValue: false },
    { value: 'is_false', label: 'is no/false', needsValue: false }
  ];

  function commit(next: ConditionGroup) {
    group = next;
    onchange?.(next);
  }

  function update(i: number, patch: Partial<Condition>) {
    commit({ ...group, conditions: group.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  }

  function parseValue(text: string): unknown {
    const n = parseNumber(text);
    return n === null ? text : n;
  }

  function display(v: unknown): string {
    return v === null || v === undefined ? '' : String(v);
  }
</script>

<div class="conds">
  {#if group.conditions.length > 1}
    <div class="mode">
      <label for="{uid}-mode" class="faint">Match</label>
      <select
        id="{uid}-mode"
        class="input"
        value={group.mode}
        onchange={(e) => commit({ ...group, mode: e.currentTarget.value as ConditionGroup['mode'] })}
      >
        <option value="all">all of these</option>
        <option value="any">any of these</option>
      </select>
    </div>
  {/if}
  {#each group.conditions as c, i (i)}
    {@const op = OPS.find((o) => o.value === c.op)}
    <div class="cond">
      <input
        class="input mono field"
        aria-label="Field"
        list="{uid}-fields"
        placeholder="field, e.g. tier"
        value={c.field}
        onchange={(e) => update(i, { field: e.currentTarget.value.trim() })}
      />
      <select
        class="input op"
        aria-label="Comparison"
        value={c.op}
        onchange={(e) => update(i, { op: e.currentTarget.value as Op })}
      >
        {#each OPS as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
      </select>
      {#if op?.needsValue !== false}
        <input
          class="input value"
          aria-label="Value"
          placeholder="value"
          value={display(c.value)}
          onchange={(e) => update(i, { value: parseValue(e.currentTarget.value) })}
        />
      {:else}
        <span class="value"></span>
      {/if}
      <IconButton
        size="sm"
        label="Remove condition"
        tone="danger"
        onclick={() => commit({ ...group, conditions: group.conditions.filter((_, j) => j !== i) })}
      >
        <X />
      </IconButton>
    </div>
  {:else}
    <p class="faint none">{emptyText}</p>
  {/each}
  <div>
    <Button
      size="sm"
      variant="ghost"
      onclick={() =>
        commit({ ...group, conditions: [...group.conditions, { field: fields[0]?.value ?? '', op: 'eq', value: '' }] })}
    >
      <Plus size={14} />Add condition
    </Button>
  </div>
  <datalist id="{uid}-fields">
    {#each fields as f (f.value)}<option value={f.value}>{f.label}</option>{/each}
  </datalist>
</div>

<style>
  .conds {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .mode {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }
  .mode select {
    width: auto;
  }
  .cond {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1fr) auto;
    gap: 6px;
    align-items: center;
  }
  .none {
    font-size: 12px;
  }
</style>
