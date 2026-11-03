<script lang="ts">
  import Dialog from '$lib/ui/Dialog.svelte';
  import { Plus } from '@lucide/svelte';
  import GraphPreview from './GraphPreview.svelte';
  import { previewContext } from './sharing';
  import { ACTION_TEMPLATES } from './templates';

  interface Props {
    open: boolean;
    /** A template id, or `blank`. */
    onpick: (id: string) => void;
  }

  let { open = $bindable(), onpick }: Props = $props();

  function pick(id: string) {
    open = false;
    onpick(id);
  }
</script>

<Dialog bind:open title="New action" description="Start blank or from a template. Templates start turned off until you switch them on." width={1040}>
  <ul class="grid" aria-label="Action templates">
    <li>
      <button type="button" class="card blank" onclick={() => pick('blank')}>
        <span class="head"><span class="icon"><Plus size={16} /></span><span class="name">Blank</span></span>
        <span class="desc faint">An empty flow to build yourself</span>
        <span class="mini empty" aria-hidden="true"><Plus size={22} /></span>
      </button>
    </li>
    {#each ACTION_TEMPLATES as t (t.id)}
      {@const Icon = t.icon}
      <li>
        <button type="button" class="card" onclick={() => pick(t.id)} aria-label="{t.name}: {t.description}">
          <span class="head"><span class="icon"><Icon size={16} /></span><span class="name">{t.name}</span></span>
          <span class="desc faint">{t.description}</span>
          <span class="mini" aria-hidden="true"><GraphPreview graph={t.pkg.actions[0]!.graph} ctx={previewContext(t.pkg)} /></span>
        </button>
      </li>
    {/each}
  </ul>
</Dialog>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    height: 100%;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-1);
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  .card:hover,
  .card:focus-visible {
    border-color: var(--accent);
    background: var(--bg-2);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex: none;
    border-radius: 8px;
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .name {
    font-weight: 650;
  }
  .desc {
    min-height: 2.6em;
    font-size: 12px;
    line-height: 1.3;
  }
  .mini {
    display: block;
    height: 130px;
    margin-top: auto;
    border-radius: var(--radius);
    background:
      radial-gradient(circle, color-mix(in srgb, var(--text) 10%, transparent) 1px, transparent 1.5px) 0 0 / 12px 12px,
      var(--bg-0);
    overflow: hidden;
    pointer-events: none;
  }
  .mini.empty {
    display: grid;
    place-items: center;
    color: var(--text-faint);
  }
</style>
