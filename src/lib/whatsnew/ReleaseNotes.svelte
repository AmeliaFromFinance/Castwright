<script lang="ts">
  import { openExternal } from '$lib/util/os';
  import { inline, type Release } from './changelog';

  interface Props {
    release: Release;
  }
  let { release }: Props = $props();
</script>

<div class="notes">
  {#each release.groups as g, gi (gi)}
    <section>
      {#if g.title}<h3 class="eyebrow">{g.title}</h3>{/if}
      <ul>
        {#each g.items as item, ii (ii)}
          <li>
            {#each inline(item) as part, pi (pi)}
              {#if part.type === 'bold'}<b>{part.text}</b>
              {:else if part.type === 'code'}<code>{part.text}</code>
              {:else if part.type === 'link'}<button type="button" class="link" onclick={() => openExternal(part.href)}>{part.text}</button>
              {:else}{part.text}{/if}
            {/each}
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</div>

<style>
  .notes {
    display: flex;
    flex-direction: column;
    gap: 14px;
    font-size: 13px;
    line-height: 1.5;
  }
  h3 {
    margin: 0 0 6px;
  }
  ul {
    margin: 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  b {
    font-weight: 650;
  }
  code {
    font-family: var(--font-mono);
    font-size: 12px;
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--bg-2);
  }
  .link {
    border: 0;
    padding: 0;
    background: none;
    color: var(--accent-text);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
</style>
