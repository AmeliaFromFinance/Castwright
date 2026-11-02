<script lang="ts">
  import { untrack } from 'svelte';
  import { app } from '$lib/state/app.svelte';
  import { api } from '$lib/api';
  import { attempt } from '$lib/state/toast.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import Field from '$lib/ui/Field.svelte';
  import Button from '$lib/ui/Button.svelte';
  import type { Category } from '$lib/bindings/Category';

  let { open = $bindable() }: { open: boolean } = $props();

  let title = $state('');
  let categoryName = $state('');
  let categoryId = $state('');
  let tags = $state('');
  let results = $state<Category[]>([]);
  let saving = $state(false);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  let wasOpen = false;
  $effect(() => {
    // Copy the current info only when the dialog opens, so status updates
    // arriving while it's open never overwrite what's being typed.
    if (open && !wasOpen) {
      untrack(() => {
        const s = app.twitch?.stream;
        title = s?.title ?? '';
        categoryName = s?.category ?? '';
        categoryId = s?.category_id ?? '';
        tags = (s?.tags ?? []).join(', ');
        results = [];
      });
    }
    wasOpen = open;
  });

  const tagList = $derived(
    tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
  );
  const tagError = $derived(
    tagList.length > 10
      ? 'Twitch allows up to 10 tags.'
      : tagList.find((t) => t.length > 25 || !/^[\p{L}\p{N}]+$/u.test(t))
        ? 'Tags are single words of letters and numbers, up to 25 characters.'
        : null
  );
  const titleError = $derived([...title].length > 140 ? 'Titles can be up to 140 characters.' : null);

  function search(q: string) {
    categoryName = q;
    categoryId = '';
    clearTimeout(searchTimer);
    if (q.trim().length < 2) {
      results = [];
      return;
    }
    searchTimer = setTimeout(async () => {
      results = (await attempt(() => api.twitchSearchCategories(q))) ?? [];
    }, 250);
  }

  async function save() {
    if (tagError || titleError) return;
    saving = true;
    const ok = await attempt(
      () => api.twitchUpdateStreamInfo(title.trim(), categoryId, tagList),
      'Stream info updated'
    );
    saving = false;
    if (ok !== undefined) open = false;
  }
</script>

<Dialog bind:open title="Stream info" description="Shown on your Twitch channel." width={520}>
  <div class="stack">
    <Field label="Title" for="si-title" error={titleError} hint="{[...title].length} / 140">
      <input id="si-title" class="input" bind:value={title} />
    </Field>
    <Field label="Category" for="si-cat" hint={categoryId ? '' : categoryName ? 'Pick a category from the list.' : ''}>
      <input
        id="si-cat"
        class="input"
        autocomplete="off"
        value={categoryName}
        oninput={(e) => search(e.currentTarget.value)}
      />
      {#if results.length}
        <ul class="results" role="listbox" aria-label="Categories">
          {#each results as c (c.id)}
            <li>
              <button
                type="button"
                role="option"
                aria-selected={c.id === categoryId}
                onclick={() => {
                  categoryId = c.id;
                  categoryName = c.name;
                  results = [];
                }}>{c.name}</button
              >
            </li>
          {/each}
        </ul>
      {/if}
    </Field>
    <Field label="Tags" for="si-tags" error={tagError} hint="Separate with commas. Up to 10.">
      <input id="si-tags" class="input" bind:value={tags} placeholder="English, Chill" />
    </Field>
  </div>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" busy={saving} disabled={!!tagError || !!titleError} onclick={save}>Save</Button>
  {/snippet}
</Dialog>

<style>
  .results {
    list-style: none;
    margin: 4px 0 0;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-2);
    max-height: 180px;
    overflow: auto;
  }
  .results button {
    width: 100%;
    text-align: left;
    padding: 6px 8px;
    border: 0;
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    cursor: pointer;
  }
  .results button:hover,
  .results button[aria-selected='true'] {
    background: var(--bg-3);
  }
</style>
