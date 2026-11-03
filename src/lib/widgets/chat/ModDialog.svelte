<script lang="ts">
  import Button from '$lib/ui/Button.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import Field from '$lib/ui/Field.svelte';
  import { mod } from './mod.svelte';
  import { toSeconds } from './moderation';

  type Unit = 's' | 'm' | 'h' | 'd';

  let amount = $state(10);
  let unit = $state<Unit>('m');
  let reason = $state('');
  let busy = $state(false);

  const d = $derived(mod.dialog);
  const ban = $derived(d?.kind === 'ban');
  let open = $state(false);

  $effect(() => {
    open = !!d;
    if (d) {
      amount = 10;
      unit = 'm';
      reason = '';
    }
  });

  async function confirm(e?: SubmitEvent) {
    e?.preventDefault();
    if (!d || busy) return;
    busy = true;
    if (ban) await mod.ban(d.user, reason.trim());
    else await mod.timeout(d.user, toSeconds(amount, unit), reason.trim());
    busy = false;
    mod.dialog = null;
  }
</script>

<Dialog
  bind:open
  title={ban ? `Ban ${d?.user.display_name ?? ''}?` : `Time out ${d?.user.display_name ?? ''}`}
  description={ban ? 'They can no longer chat in your channel until you unban them.' : 'Up to 14 days.'}
  width={420}
  onclose={() => (mod.dialog = null)}
>
  <form id="mod-dialog-form" class="form" onsubmit={confirm}>
    {#if !ban}
      <Field label="Duration" for="mod-amount">
        <div class="dur">
          <input id="mod-amount" class="input" type="number" min="1" step="1" bind:value={amount} />
          <select class="input" aria-label="Unit" bind:value={unit}>
            <option value="s">seconds</option>
            <option value="m">minutes</option>
            <option value="h">hours</option>
            <option value="d">days</option>
          </select>
        </div>
      </Field>
    {/if}
    <Field label="Reason (optional)" for="mod-reason" hint="Twitch shows it to the viewer and in the mod log.">
      <input id="mod-reason" class="input" maxlength="500" bind:value={reason} />
    </Field>
  </form>
  {#snippet footer()}
    <Button onclick={() => (mod.dialog = null)}>Cancel</Button>
    <Button type="submit" form="mod-dialog-form" variant={ban ? 'danger' : 'primary'} {busy} disabled={!ban && !(amount > 0)}>{ban ? 'Ban' : 'Time out'}</Button>
  {/snippet}
</Dialog>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .dur {
    display: flex;
    gap: 6px;
  }
  .dur input {
    width: 90px;
  }
</style>
