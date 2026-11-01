<script lang="ts">
  import { onDestroy } from 'svelte';
  import { app } from '$lib/state/app.svelte';
  import { api } from '$lib/api';
  import { attempt, toasts } from '$lib/state/toast.svelte';
  import type { AccountRole } from '$lib/bindings/AccountRole';
  import type { DeviceLogin } from '$lib/bindings/DeviceLogin';
  import type { TwitchAccount } from '$lib/bindings/TwitchAccount';
  import { copyText, openExternal } from '$lib/util/os';
  import Button from '$lib/ui/Button.svelte';
  import Badge from '$lib/ui/Badge.svelte';
  import { Copy, ExternalLink, LogOut, Loader, UserRound } from '@lucide/svelte';

  interface Props {
    /** Hide the optional bot account (first-run). */
    broadcasterOnly?: boolean;
  }
  let { broadcasterOnly = false }: Props = $props();

  const roles: Array<{ role: AccountRole; title: string; hint: string }> = [
    { role: 'broadcaster', title: 'Your channel', hint: 'Needed for events, chat and stream info.' },
    { role: 'bot', title: 'Bot account', hint: 'Optional. Sends chat messages under a separate name.' }
  ];

  let pending = $state<Partial<Record<AccountRole, DeviceLogin & { until: number }>>>({});
  let now = $state(Date.now());
  const tick = setInterval(() => (now = Date.now()), 1000);
  onDestroy(() => {
    clearInterval(tick);
    for (const r of Object.keys(pending) as AccountRole[]) api.twitchCancelLogin(r).catch(() => {});
  });

  function account(role: AccountRole): TwitchAccount | null {
    return (role === 'bot' ? app.twitch?.bot : app.twitch?.broadcaster) ?? null;
  }

  // Sign-in finishes in the background; drop the code card once the account shows up.
  $effect(() => {
    for (const r of Object.keys(pending) as AccountRole[]) {
      if (account(r)) {
        delete pending[r];
        toasts.success(`Signed in as ${account(r)!.display_name}`);
      } else if (pending[r] && pending[r]!.until < now) {
        delete pending[r];
      }
    }
  });

  async function login(role: AccountRole) {
    const code = await attempt(() => api.twitchLogin(role));
    if (!code) return;
    pending[role] = { ...code, until: Date.now() + code.expires_in_s * 1000 };
    openExternal(code.verification_uri).catch(() => {});
  }

  async function cancel(role: AccountRole) {
    delete pending[role];
    await api.twitchCancelLogin(role).catch(() => {});
  }

  function left(until: number): string {
    const s = Math.max(0, Math.round((until - now) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
</script>

<div class="accounts">
  {#if app.twitch && !app.twitch.has_client_id}
    <p class="note">Add a Twitch client ID first (see below). This build doesn't include one.</p>
  {/if}
  {#each broadcasterOnly ? roles.slice(0, 1) : roles as r (r.role)}
    {@const acc = account(r.role)}
    {@const code = pending[r.role]}
    <div class="acct">
      <div class="avatar" aria-hidden="true">
        {#if acc?.profile_image_url}
          <img src={acc.profile_image_url} alt="" />
        {:else if acc}
          {acc.display_name.slice(0, 1).toUpperCase()}
        {:else}
          <UserRound size={18} />
        {/if}
      </div>
      <div class="who grow">
        <div class="row name">
          <b>{acc ? acc.display_name : r.title}</b>
          {#if acc}<Badge tone="ok">Signed in</Badge>{/if}
        </div>
        <div class="faint small">{acc ? `${r.title} · twitch.tv/${acc.login}` : r.hint}</div>
      </div>
      {#if acc}
        <Button size="sm" variant="ghost" onclick={() => attempt(() => api.twitchLogout(r.role), 'Signed out')}>
          <LogOut size={14} />Sign out
        </Button>
      {:else if !code}
        <Button
          size="sm"
          variant={r.role === 'broadcaster' ? 'primary' : 'secondary'}
          disabled={app.twitch ? !app.twitch.has_client_id : false}
          onclick={() => login(r.role)}
        >
          Sign in with Twitch
        </Button>
      {/if}
    </div>
    {#if code && !acc}
      <div class="code" role="status">
        <div class="steps">
          <p>
            1. Open <button type="button" class="link" onclick={() => openExternal(code.verification_uri)}
              >{code.verification_uri.replace(/^https?:\/\//, '')} <ExternalLink size={12} /></button
            >
          </p>
          <p>2. Enter this code{r.role === 'bot' ? ' while signed in as the bot account' : ''}:</p>
        </div>
        <div class="row">
          <span class="user-code mono selectable">{code.user_code}</span>
          <Button size="sm" onclick={() => copyText(code.user_code, 'Code copied')}><Copy size={14} />Copy</Button>
        </div>
        <div class="row faint small">
          <Loader size={13} class="spin" />
          <span>Waiting for Twitch… code expires in {left(code.until)}</span>
          <div class="grow"></div>
          <Button size="sm" variant="ghost" onclick={() => cancel(r.role)}>Cancel</Button>
        </div>
      </div>
    {/if}
  {/each}

  {#if app.twitch?.error}
    <p class="err" role="alert">{app.twitch.error}</p>
  {/if}
  {#if app.twitch?.failed_subscriptions.length}
    <p class="note">
      Twitch refused {app.twitch.failed_subscriptions.length} event type{app.twitch.failed_subscriptions.length === 1
        ? ''
        : 's'}: {app.twitch.failed_subscriptions.join(', ')}. Signing out and in again usually fixes this.
    </p>
  {/if}
</div>

<style>
  .accounts {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 560px;
  }
  .acct {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-1);
  }
  .avatar {
    width: 36px;
    height: 36px;
    flex: none;
    border-radius: 50%;
    display: grid;
    place-items: center;
    overflow: hidden;
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 700;
  }
  .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .name {
    gap: 8px;
  }
  .small {
    font-size: 12px;
  }
  .code {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    margin-top: -4px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-2);
    font-size: 13px;
  }
  .steps p + p {
    margin-top: 4px;
  }
  .user-code {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: 0.12em;
    padding: 4px 12px;
    border-radius: var(--radius);
    background: var(--bg-1);
    border: 1px solid var(--border);
  }
  .code .row {
    gap: 8px;
  }
  .link {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--accent-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .note {
    font-size: 12.5px;
    color: var(--warn);
    line-height: 1.45;
  }
  .err {
    font-size: 12.5px;
    color: var(--danger);
  }
  :global(.spin) {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
