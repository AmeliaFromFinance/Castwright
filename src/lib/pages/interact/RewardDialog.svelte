<script lang="ts">
  import type { Reward } from '$lib/bindings/Reward';
  import NumberInput from '$lib/editor/ui/NumberInput.svelte';
  import { toasts } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import ColorInput from '$lib/ui/ColorInput.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import { MAX_PROMPT, MAX_REWARD_TITLE, REWARD_COLORS, newReward, rewardIssues } from './forms';
  import { interact } from './store.svelte';

  interface Props {
    open: boolean;
    /** The reward to edit, or a new one without an id. */
    reward: Reward;
  }

  let { open = $bindable(), reward }: Props = $props();

  let r = $state<Reward>(newReward());
  let tried = $state(false);
  let busy = $state(false);

  $effect(() => {
    if (open) {
      r = structuredClone($state.snapshot(reward));
      tried = false;
    }
  });

  const issues = $derived(rewardIssues(r, interact.rewards));
  const shown = $derived(tried ? issues : {});
  const creating = $derived(!r.id);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    tried = true;
    if (Object.keys(issues).length) return;
    busy = true;
    try {
      await interact.saveReward($state.snapshot(r));
      toasts.success(creating ? `Created "${r.title.trim()}"` : 'Reward saved');
      open = false;
    } catch (err) {
      toasts.error(err);
    } finally {
      busy = false;
    }
  }
</script>

{#snippet error(key: string)}
  {#if shown[key]}<p class="error" role="alert">{shown[key]}</p>{/if}
{/snippet}

<Dialog bind:open title={creating ? 'New reward' : 'Edit reward'} width={560}>
  <form id="reward-form" class="form" onsubmit={submit} novalidate>
    <div class="two">
      <div class="f wide">
        <label for="rw-title">Title</label>
        <input id="rw-title" class="input" maxlength={MAX_REWARD_TITLE + 10} aria-invalid={shown.title ? 'true' : undefined} bind:value={r.title} placeholder="Hydrate" />
        {@render error('title')}
      </div>
      <div class="f">
        <label for="rw-cost">Cost</label>
        <NumberInput id="rw-cost" label="Cost in points" unit="pts" min={1} max={10_000_000} value={r.cost} oninput={(v) => (r.cost = Math.round(v))} />
        {@render error('cost')}
      </div>
    </div>

    <div class="f">
      <label for="rw-prompt">Description <span class="faint">(optional)</span></label>
      <textarea id="rw-prompt" class="input" rows="2" maxlength={MAX_PROMPT + 20} bind:value={r.prompt} placeholder="What happens when someone redeems it"></textarea>
      {@render error('prompt')}
    </div>

    <div class="f">
      <span class="label">Colour</span>
      <div class="colors">
        {#each REWARD_COLORS as c (c)}
          <button
            type="button"
            class="swatch"
            style:background={c}
            aria-label="Colour {c}"
            aria-pressed={r.color.toLowerCase() === c.toLowerCase()}
            onclick={() => (r.color = c)}
          ></button>
        {/each}
        <ColorInput label="Custom colour" value={r.color} onchange={(v) => (r.color = v)} />
      </div>
      {@render error('color')}
    </div>

    <div class="three">
      <div class="f">
        <label for="rw-cd">Cooldown</label>
        <NumberInput id="rw-cd" label="Cooldown in seconds" unit="s" min={0} max={604_800} value={r.cooldown_s} oninput={(v) => (r.cooldown_s = Math.round(v))} />
        {@render error('cooldown_s')}
      </div>
      <div class="f">
        <label for="rw-max">Max per stream</label>
        <NumberInput id="rw-max" label="Max per stream" min={0} max={100_000} value={r.max_per_stream} oninput={(v) => (r.max_per_stream = Math.round(v))} />
      </div>
      <div class="f">
        <label for="rw-user">Max per viewer</label>
        <NumberInput id="rw-user" label="Max per viewer per stream" min={0} max={100_000} value={r.max_per_user} oninput={(v) => (r.max_per_user = Math.round(v))} />
      </div>
    </div>
    <p class="hint">0 means no cooldown or no limit.</p>

    <div class="switches">
      <Switch label="Viewer types a message" showLabel checked={r.input_required} onchange={(v) => (r.input_required = v)} />
      <Switch label="Skip the queue (complete right away)" showLabel checked={r.skip_queue} onchange={(v) => (r.skip_queue = v)} />
      <Switch label="On" showLabel checked={r.enabled} onchange={(v) => (r.enabled = v)} />
    </div>
  </form>

  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form="reward-form" {busy}>{creating ? 'Create reward' : 'Save'}</Button>
  {/snippet}
</Dialog>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .two {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 160px;
    gap: 10px;
  }
  .three {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }
  .f {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .f > label,
  .label {
    font-size: 12px;
    font-weight: 550;
    color: var(--text-muted);
  }
  .colors {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .swatch {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 2px solid transparent;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.2);
  }
  .swatch[aria-pressed='true'] {
    border-color: var(--text);
  }
  .switches {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .hint {
    margin-top: -6px;
    font-size: 12px;
    color: var(--text-faint);
  }
  .error {
    font-size: 12px;
    color: var(--danger);
  }
</style>
