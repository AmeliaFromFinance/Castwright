<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { api } from '$lib/api';
  import { attempt } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { Plug } from '@lucide/svelte';

  let busy = $state(false);

  async function connect() {
    busy = true;
    await attempt(() => api.obsConnect(), 'Connected to OBS');
    busy = false;
  }
</script>

<div class="wrap">
  <div class="card">
    <div class="icon"><Plug size={26} /></div>
    <h2>Connect OBS to go live</h2>
    <p class="muted">
      Castwright uses OBS Studio for video. Open OBS, go to <b>Tools → WebSocket Server Settings</b>, tick
      <b>Enable WebSocket server</b>, then connect.
    </p>
    {#if app.obs.error}<p class="err" role="alert">{app.obs.error}</p>{/if}
    <div class="row">
      <Button variant="primary" busy={busy || app.obs.state === 'connecting'} onclick={connect}>Connect to OBS</Button>
      <Button variant="ghost" onclick={() => (app.page = 'settings')}>Connection settings</Button>
    </div>
    <p class="faint small">Overlays, alerts, chat and automation keep working without OBS.</p>
  </div>
</div>

<style>
  .wrap {
    flex: 1;
    display: grid;
    place-items: center;
    padding: 24px;
  }
  .card {
    max-width: 460px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: flex-start;
    padding: 28px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: var(--bg-1);
  }
  .icon {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  h2 {
    font-size: 18px;
  }
  .err {
    color: var(--danger);
    font-size: 12.5px;
  }
  .small {
    font-size: 12px;
  }
</style>
