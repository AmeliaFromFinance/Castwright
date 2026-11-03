<script lang="ts">
  import Button from '$lib/ui/Button.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import { openExternal } from '$lib/util/os';
  import { inline, shortVersion } from './changelog';
  import { whatsNew } from './whatsnew.svelte';

  const CHANGELOG = 'https://castwright.sinist3r.lol/changelog/';

  const r = $derived(whatsNew.shown);
  let open = $state(false);
  $effect(() => {
    open = !!r;
  });
</script>

<Dialog
  bind:open
  title={r ? `What's new in v${shortVersion(r.version)}` : ''}
  description={whatsNew.download ? 'A newer version is out.' : r?.note && r.note !== 'upcoming' ? `Released ${r.note}` : undefined}
  width={560}
  onclose={() => whatsNew.close()}
>
  {#if r}
    <div class="notes">
      {#each r.groups as g, gi (gi)}
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
  {/if}
  {#snippet footer()}
    <Button variant="ghost" onclick={() => openExternal(CHANGELOG)}>Full changelog</Button>
    <span class="grow"></span>
    {#if whatsNew.download}
      <Button onclick={() => whatsNew.close()}>Later</Button>
      <Button variant="primary" onclick={() => openExternal(whatsNew.download!)}>Get v{shortVersion(r?.version ?? '')}</Button>
    {:else}
      <Button variant="primary" onclick={() => whatsNew.close()}>Got it</Button>
    {/if}
  {/snippet}
</Dialog>

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
