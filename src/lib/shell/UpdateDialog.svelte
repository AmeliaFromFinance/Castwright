<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { updates, RELEASES_PAGE } from '$lib/state/updates.svelte';
  import { percent, progressText } from '$lib/state/update-flow';
  import { toasts } from '$lib/state/toast.svelte';
  import { isTauri } from '$lib/api/backend';
  import { openExternal } from '$lib/util/os';
  import { parseNotes, shortVersion } from '$lib/whatsnew/changelog';
  import ReleaseNotes from '$lib/whatsnew/ReleaseNotes.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import { CircleAlert, Radio } from '@lucide/svelte';

  const u = $derived(updates.available);
  const p = $derived(updates.phase);
  const notes = $derived(u ? parseNotes(u.notes, u.version) : null);
  const live = $derived(app.obs.stream.active || !!app.twitch?.stream.live);
  const version = $derived(u ? `v${shortVersion(u.version)}` : '');
  const pct = $derived(p.kind === 'downloading' ? percent(p.downloaded, p.total) : null);
  let confirmLive = $state(false);

  async function restart(confirmed = false) {
    confirmLive = false;
    await updates.restart(confirmed);
    if (!isTauri() && updates.phase.kind === 'restarting') {
      toasts.show(`This is the demo. The desktop app restarts on ${version} now.`, 'info', 6000);
      updates.open = false;
      updates.available = null;
      updates.dispatch({ type: 'reset' });
    }
  }

  function close() {
    confirmLive = false;
    updates.open = false;
  }
</script>

<Dialog
  bind:open={updates.open}
  title={u ? `Castwright ${version} is out` : 'Update'}
  description={app.info ? `You have v${shortVersion(app.info.version)}.` : undefined}
  width={560}
  onclose={close}
>
  {#if notes?.groups.length}
    <div class="notes"><ReleaseNotes release={notes} /></div>
  {:else if u}
    <p class="muted">This release has no notes. <button type="button" class="link" onclick={() => openExternal(u.url)}>See it on GitHub</button>.</p>
  {/if}

  {#if p.kind === 'downloading'}
    <div class="progress" role="group" aria-label="Download progress">
      <div class="bar" role="progressbar" aria-label="Downloading update" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
        <span style:width="{pct ?? 4}%"></span>
      </div>
      <div class="row-text"><span>Downloading {version}</span><span class="mono">{progressText(p.downloaded, p.total)}</span></div>
    </div>
  {:else if p.kind === 'available' && !p.canInstall && p.reason}
    <p class="note">{p.reason} Download the new version from GitHub and install it over this one. Your settings stay.</p>
  {:else if p.kind === 'ready' && live}
    <p class="note"><Radio size={14} /> You're live. Castwright waits for the stream to end, then asks before it restarts.</p>
  {:else if p.kind === 'waiting'}
    <p class="note"><Radio size={14} /> Castwright restarts after the stream. It asks you first.</p>
  {:else if p.kind === 'ask'}
    <p class="note">Your stream has ended. Restart now to finish the update?</p>
  {:else if p.kind === 'restarting'}
    <p class="note" aria-busy="true">Installing and restarting…</p>
  {:else if p.kind === 'error'}
    <p class="note bad" role="alert"><CircleAlert size={14} /> {p.message}</p>
  {/if}

  {#if confirmLive}
    <p class="note warn" role="alert">
      Restart while live? Your stream keeps going in OBS, but alerts, overlays and chat tools stop for a moment.
    </p>
  {/if}

  {#snippet footer()}
    <span class="grow"></span>
    {#if confirmLive}
      <Button onclick={() => (confirmLive = false)}>Cancel</Button>
      <Button variant="danger" onclick={() => restart(true)}>Restart anyway</Button>
    {:else if p.kind === 'available' && p.canInstall}
      <Button onclick={close}>Later</Button>
      <Button variant="primary" onclick={() => updates.download()}>Download and install</Button>
    {:else if p.kind === 'downloading'}
      <Button onclick={close}>Hide</Button>
    {:else if p.kind === 'ready' || p.kind === 'ask'}
      {#if live}
        <Button variant="ghost" onclick={() => (confirmLive = true)}>Restart now…</Button>
        <Button variant="primary" onclick={() => restart()}>Restart after stream</Button>
      {:else}
        <Button onclick={close}>Later</Button>
        <Button variant="primary" onclick={() => restart()}>Restart to update</Button>
      {/if}
    {:else if p.kind === 'waiting'}
      <Button onclick={() => updates.cancelRestart()}>Don't restart</Button>
      <Button variant="primary" onclick={close}>OK</Button>
    {:else if p.kind === 'error'}
      <Button onclick={() => updates.download()}>Try again</Button>
      <Button variant="primary" onclick={() => openExternal(u?.url ?? RELEASES_PAGE)}>Download from GitHub</Button>
    {:else if p.kind !== 'restarting'}
      <Button onclick={close}>Later</Button>
      <Button variant="primary" onclick={() => openExternal(u?.url ?? RELEASES_PAGE)}>Download from GitHub</Button>
    {/if}
  {/snippet}
</Dialog>

<style>
  .notes {
    max-height: 46vh;
    overflow: auto;
  }
  .progress {
    margin-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .bar {
    height: 8px;
    border-radius: 999px;
    background: var(--bg-3);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
    transition: width 0.2s var(--ease);
  }
  .row-text {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: var(--text-muted);
  }
  .note {
    margin-top: 14px;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
  }
  .note.bad {
    color: var(--danger);
  }
  .note.warn {
    color: var(--warn);
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
