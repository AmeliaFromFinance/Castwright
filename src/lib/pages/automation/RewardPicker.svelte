<script lang="ts" module>
  import { api } from '$lib/api';
  import type { Reward } from '$lib/bindings/Reward';

  let cache = $state<{ list: Reward[]; error: string } | null>(null);
  let loading: Promise<void> | null = null;

  function load() {
    loading ??= api
      .rewards()
      .then((list) => void (cache = { list, error: '' }))
      .catch((e: { message?: string }) => void (cache = { list: [], error: e?.message ?? 'Couldn’t load rewards.' }))
      .finally(() => (loading = null));
  }
</script>

<script lang="ts">
  interface Props {
    id: string;
    rewardId: string;
    rewardTitle: string;
    /** Allow "Any reward" (an empty pick). */
    any?: boolean;
    /** Only rewards made in Castwright can be picked. */
    onlyMine?: boolean;
    onchange: (id: string, title: string) => void;
  }

  let { id, rewardId, rewardTitle, any = false, onlyMine = false, onchange }: Props = $props();

  $effect(() => {
    if (!cache) load();
  });

  const list = $derived(cache?.list ?? []);
  const known = $derived(list.some((r) => r.id === rewardId) || (!rewardId && !rewardTitle));
</script>

{#if cache && !cache.error}
  <select
    {id}
    class="input"
    value={known ? rewardId : '__saved'}
    onchange={(e) => {
      const r = list.find((x) => x.id === e.currentTarget.value);
      onchange(r?.id ?? '', r?.title ?? '');
    }}
  >
    <option value="">{any ? 'Any reward' : 'Pick a reward'}</option>
    {#each list as r (r.id)}
      <option value={r.id} disabled={onlyMine && !r.manageable}>{r.title}{onlyMine && !r.manageable ? ' (made on Twitch)' : ''}</option>
    {/each}
    {#if !known}<option value="__saved">{rewardTitle || 'Saved reward'} (not found)</option>{/if}
  </select>
{:else}
  <input
    {id}
    class="input"
    placeholder={any ? 'Any reward' : 'Reward title'}
    title={cache?.error}
    value={rewardTitle}
    oninput={(e) => onchange('', e.currentTarget.value)}
  />
{/if}
