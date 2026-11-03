<script lang="ts">
  import Button from '$lib/ui/Button.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import { openExternal } from '$lib/util/os';
  import { shortVersion } from './changelog';
  import ReleaseNotes from './ReleaseNotes.svelte';
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
  description={r?.note && r.note !== 'upcoming' ? `Released ${r.note}` : undefined}
  width={560}
  onclose={() => whatsNew.close()}
>
  {#if r}
    <ReleaseNotes release={r} />
  {/if}
  {#snippet footer()}
    <Button variant="ghost" onclick={() => openExternal(CHANGELOG)}>Full changelog</Button>
    <span class="grow"></span>
    <Button variant="primary" onclick={() => whatsNew.close()}>Got it</Button>
  {/snippet}
</Dialog>
