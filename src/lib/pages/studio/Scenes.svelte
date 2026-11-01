<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { api } from '$lib/api';
  import { attempt } from '$lib/state/toast.svelte';
  import Panel from '$lib/ui/Panel.svelte';

  const obs = $derived(app.obs);

  function pick(scene: string) {
    if (obs.studio_mode) attempt(() => api.obsSetPreviewScene(scene));
    else attempt(() => api.obsSetProgramScene(scene));
  }
</script>

<Panel title="Scenes" flush>
  <ul class="list" role="listbox" aria-label="Scenes">
    {#each obs.scenes as scene, i (scene)}
      {@const isProgram = scene === obs.program_scene}
      {@const isPreview = obs.studio_mode && scene === obs.preview_scene}
      <li>
        <button
          type="button"
          role="option"
          aria-selected={obs.studio_mode ? isPreview : isProgram}
          class:program={isProgram}
          class:preview={isPreview}
          ondblclick={() => obs.studio_mode && attempt(() => api.obsSetProgramScene(scene))}
          onclick={() => pick(scene)}
        >
          {#if isProgram}<span class="dot live" title="On air"></span>{:else if isPreview}<span class="dot prev" title="In preview"></span>{:else}<span class="dot"></span>{/if}
          <span class="grow truncate">{scene}</span>
          {#if i < 9}<span class="faint key mono">{i + 1}</span>{/if}
        </button>
      </li>
    {:else}
      <li class="none muted">No scenes</li>
    {/each}
  </ul>
</Panel>

<style>
  .list {
    list-style: none;
    margin: 0;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    height: var(--row-h);
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    text-align: left;
    cursor: pointer;
    color: var(--text);
  }
  button:hover {
    background: var(--bg-2);
  }
  button[aria-selected='true'] {
    background: var(--bg-3);
    font-weight: 600;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: none;
    background: transparent;
  }
  .dot.live {
    background: var(--live);
  }
  .dot.prev {
    background: var(--accent);
  }
  .key {
    font-size: 11px;
  }
  .none {
    padding: 10px;
  }
</style>
