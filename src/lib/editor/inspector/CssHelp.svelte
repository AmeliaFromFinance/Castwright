<script lang="ts">
  import type { LayerKind } from '$lib/bindings/LayerKind';
  import { selectorsFor, variablesFor } from '$lib/overlay/selectors';
  import { scopeClass } from '$lib/overlay/styles';
  import Collapse from '$lib/ui/Collapse.svelte';

  interface Props {
    kind: LayerKind['type'];
    layerId: string;
    /** Adds a rule for the selector to the editor. */
    oninsert: (selector: string) => void;
  }

  let { kind, layerId, oninsert }: Props = $props();

  const selectors = $derived(selectorsFor(kind));
  const variables = $derived(variablesFor(kind));
</script>

<Collapse id="insp.css.help" title="What you can target" meta={selectors.length} open={false}>
  <div class="help">
    <p class="hint">Click one to add a rule at the cursor. Rules only reach this layer.</p>
    <ul class="list" aria-label="Selectors">
      {#each selectors as s (s.selector)}
        <li>
          <button type="button" class="sel" onclick={() => oninsert(s.selector)} title="Add a {s.selector} rule">
            <code class="mono">{s.selector}</code>
            <span class="desc">{s.description}</span>
          </button>
        </li>
      {/each}
    </ul>
    {#if variables.length}
      <p class="eyebrow">Variables</p>
      <ul class="list" aria-label="Variables">
        {#each variables as v (v.name)}
          <li class="var"><code class="mono">{v.name}</code><span class="desc">{v.description}</span></li>
        {/each}
      </ul>
    {/if}
    <p class="hint">
      In the overlay page this layer is <code class="mono selectable">[data-layer-id="{layerId}"]</code> and its box carries
      <code class="mono selectable">.{scopeClass(layerId)}</code>.
    </p>
  </div>
</Collapse>

<style>
  .help {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 2px 0 8px;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .sel,
  .var {
    display: grid;
    grid-template-columns: minmax(0, auto) minmax(0, 1fr);
    gap: 8px;
    align-items: baseline;
    width: 100%;
    padding: 3px 6px;
    border-radius: 5px;
    text-align: left;
  }
  .sel:hover,
  .sel:focus-visible {
    background: var(--bg-2);
    outline: none;
  }
  .sel:focus-visible {
    box-shadow: 0 0 0 2px var(--focus);
  }
  code {
    font-size: 11.5px;
    color: var(--accent-text);
    overflow-wrap: anywhere;
  }
  .desc {
    font-size: 11.5px;
    color: var(--text-muted);
    line-height: 1.35;
  }
  .hint {
    font-size: 11.5px;
    color: var(--text-faint);
    line-height: 1.4;
  }
  .hint code {
    color: var(--text-muted);
  }
  .eyebrow {
    margin-top: 4px;
  }
</style>
