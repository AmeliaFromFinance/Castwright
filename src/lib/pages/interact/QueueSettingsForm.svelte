<script lang="ts">
  import { api } from '$lib/api';
  import type { QueueSettings } from '$lib/bindings/QueueSettings';
  import type { SubPriority } from '$lib/bindings/SubPriority';
  import NumberInput from '$lib/editor/ui/NumberInput.svelte';
  import { toasts } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Collapse from '$lib/ui/Collapse.svelte';
  import Segmented from '$lib/ui/Segmented.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import ChatLineField from './ChatLineField.svelte';
  import { queueIssues } from './play-forms';

  interface Props {
    settings: QueueSettings;
  }

  let { settings }: Props = $props();

  // svelte-ignore state_referenced_locally
  let draft = $state<QueueSettings>(structuredClone($state.snapshot(settings)));
  let busy = $state(false);
  const err = $derived(queueIssues(draft));
  const dirty = $derived(JSON.stringify(draft) !== JSON.stringify(settings));

  const PRIORITY: Array<{ value: SubPriority; label: string }> = [
    { value: 'off', label: 'Off' },
    { value: 'first', label: 'Subs first' },
    { value: 'lane', label: 'Own lane' }
  ];
  const WORDS = [
    ['join_word', 'Join'],
    ['leave_word', 'Leave'],
    ['position_word', 'Position']
  ] as const;
  const TOKENS = [
    { token: 'name', label: 'Who' },
    { token: 'position', label: 'Place in line' },
    { token: 'players', label: 'Everyone picked' },
    { token: 'size', label: 'People waiting' }
  ];

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (Object.keys(err).length) return;
    busy = true;
    try {
      draft = await api.saveQueueSettings($state.snapshot(draft));
      toasts.success('Queue settings saved');
    } catch (x) {
      toasts.error(x);
    } finally {
      busy = false;
    }
  }
</script>

<form class="form" onsubmit={save} novalidate aria-label="Queue settings">
  <div class="three">
    {#each WORDS as [key, label] (key)}
      <div class="f">
        <label for="q-{key}">{label}</label>
        <input id="q-{key}" class="input mono" aria-invalid={err[key] ? 'true' : undefined} bind:value={draft[key]} />
        {#if err[key]}<p class="error">{err[key]}</p>{/if}
      </div>
    {/each}
  </div>
  {#if err.words}<p class="error">{err.words}</p>{/if}
  <Switch label="!join <name> saves a note, like an in-game name" showLabel checked={draft.notes} onchange={(v) => (draft.notes = v)} />

  <div class="f">
    <span class="label">Sub priority</span>
    <Segmented label="Sub priority" value={draft.sub_priority} options={PRIORITY} onchange={(v) => (draft.sub_priority = v)} />
    <p class="hint">
      {#if draft.sub_priority === 'first'}Subs line up ahead of everyone else.{:else if draft.sub_priority === 'lane'}Subs have their own line. Picks take turns between the two.{:else}Everyone lines up in the order they join.{/if}
    </p>
  </div>

  <div class="three">
    <div class="f">
      <span class="label">Party size</span>
      <NumberInput label="Party size" unit="players" min={1} max={20} value={draft.party_size} oninput={(v) => (draft.party_size = Math.min(20, Math.max(1, Math.round(v))))} />
    </div>
    <div class="f">
      <span class="label">Max in line</span>
      <NumberInput label="Most people in line" min={0} max={1000} value={draft.max_size} oninput={(v) => (draft.max_size = Math.min(1000, Math.max(0, Math.round(v))))} />
    </div>
    <div class="f">
      <span class="label">Keep after closing</span>
      <NumberInput label="Hours to keep the queue" unit="h" min={0} max={72} value={draft.keep_hours} oninput={(v) => (draft.keep_hours = Math.min(72, Math.max(0, Math.round(v))))} />
    </div>
  </div>
  <p class="hint">Max 0 means no limit. The queue is kept if the app closes or crashes, for this many hours.</p>

  <Collapse id="q-messages" title="Chat messages" open={false}>
    <div class="lines">
      <ChatLineField label="Joined" line={draft.messages.joined} tokens={TOKENS} hint="Joins that arrive close together are answered in one message." onchange={(l) => (draft.messages.joined = l)} />
      <ChatLineField label="Left" line={draft.messages.left} tokens={TOKENS} onchange={(l) => (draft.messages.left = l)} />
      <ChatLineField label="You're up" line={draft.messages.up} tokens={TOKENS} onchange={(l) => (draft.messages.up = l)} />
      <ChatLineField label="Position" line={draft.messages.position} tokens={TOKENS} onchange={(l) => (draft.messages.position = l)} />
    </div>
  </Collapse>

  <div class="actions">
    <Button variant="primary" type="submit" {busy} disabled={!dirty}>Save</Button>
  </div>
</form>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 12px;
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
  .three {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .lines {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 6px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
  }
  .hint {
    font-size: 12px;
    color: var(--text-faint);
  }
  .error {
    font-size: 12px;
    color: var(--danger);
  }
</style>
