<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { api } from '$lib/api';
  import { errorMessage } from '$lib/api/backend';
  import { toasts } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Field from '$lib/ui/Field.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import Badge from '$lib/ui/Badge.svelte';
  import { CircleCheck, CircleAlert } from '@lucide/svelte';

  interface Props {
    /** Called after a successful save. */
    onsaved?: () => void;
    compact?: boolean;
  }
  let { onsaved, compact = false }: Props = $props();

  const saved = app.settings?.obs;
  let host = $state(saved?.host ?? '127.0.0.1');
  let port = $state(saved?.port ?? 4455);
  let password = $state('');
  let changePassword = $state(!saved?.has_password);
  let autoConnect = $state(saved?.auto_connect ?? true);
  let testing = $state(false);
  let saving = $state(false);
  let result = $state<{ ok: boolean; text: string } | null>(null);

  const portValid = $derived(Number.isInteger(port) && port > 0 && port < 65536);
  const hostValid = $derived(host.trim().length > 0);

  async function test() {
    testing = true;
    result = null;
    try {
      // null = use the saved password.
      const v = await api.obsTestConnection(host.trim(), port, changePassword ? password || null : null);
      result = { ok: true, text: `Connected. OBS ${v} answered.` };
    } catch (e) {
      result = { ok: false, text: errorMessage(e) };
    }
    testing = false;
  }

  async function save() {
    saving = true;
    try {
      await api.obsSaveConnection(host.trim(), port, password || null, !changePassword, autoConnect);
      await app.reloadSettings();
      password = '';
      changePassword = !app.settings?.obs.has_password;
      toasts.success('OBS connection saved');
      onsaved?.();
    } catch (e) {
      result = { ok: false, text: errorMessage(e) };
    }
    saving = false;
  }
</script>

<form
  class="obs-form"
  class:compact
  onsubmit={(e) => {
    e.preventDefault();
    save();
  }}
>
  <div class="grid">
    <Field label="Address" for="obs-host" hint="127.0.0.1 when OBS runs on this computer" error={hostValid ? null : 'Required'}>
      <input id="obs-host" class="input mono" bind:value={host} autocomplete="off" spellcheck="false" aria-invalid={!hostValid} />
    </Field>
    <Field label="Port" for="obs-port" error={portValid ? null : '1 to 65535'}>
      <input id="obs-port" class="input mono" type="number" min="1" max="65535" bind:value={port} aria-invalid={!portValid} />
    </Field>
  </div>

  {#if changePassword}
    <Field label="Password" for="obs-pass" hint="From OBS → Tools → WebSocket Server Settings → Show Connect Info">
      <input id="obs-pass" class="input mono" type="password" bind:value={password} autocomplete="off" />
    </Field>
  {:else}
    <div class="row saved-pass">
      <span class="muted">Password saved in your system keychain.</span>
      <Button size="sm" variant="ghost" type="button" onclick={() => (changePassword = true)}>Change</Button>
    </div>
  {/if}

  <Switch label="Connect automatically when Castwright starts" showLabel bind:checked={autoConnect} />

  {#if result}
    <div class="result" class:ok={result.ok} role="status">
      {#if result.ok}<CircleCheck size={15} />{:else}<CircleAlert size={15} />{/if}
      <span>{result.text}</span>
    </div>
  {/if}

  <div class="row actions">
    <Button type="submit" variant="primary" busy={saving} disabled={!portValid || !hostValid}>Save and connect</Button>
    <Button type="button" busy={testing} disabled={!portValid || !hostValid} onclick={test}>Test</Button>
    <div class="grow"></div>
    {#if !compact}
      {#if app.obs.state === 'connected'}
        <Badge tone="ok">Connected · OBS {app.obs.obs_version}</Badge>
      {:else if app.obs.state === 'connecting'}
        <Badge>Connecting…</Badge>
      {:else}
        <Badge tone="neutral">Not connected</Badge>
      {/if}
    {/if}
  </div>
</form>

<style>
  .obs-form {
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-width: 520px;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 120px;
    gap: 12px;
  }
  .saved-pass {
    gap: 8px;
    font-size: 13px;
  }
  .result {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    font-size: 12.5px;
    color: var(--danger);
    line-height: 1.45;
  }
  .result.ok {
    color: var(--ok);
  }
  .result :global(svg) {
    flex: none;
    margin-top: 1px;
  }
  .actions {
    gap: 8px;
  }
</style>
