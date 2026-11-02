<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { api } from '$lib/api';
  import { attemptOk } from '$lib/state/toast.svelte';
  import { BUILT_IN, generateTokens } from '$lib/theme/themes';
  import { updateAppearance } from '$lib/pages/settings/theme-settings.svelte';
  import Button from '$lib/ui/Button.svelte';
  import ObsForm from '$lib/widgets/ObsForm.svelte';
  import TwitchAccounts from '$lib/widgets/TwitchAccounts.svelte';
  import { Check, ArrowLeft, ArrowRight, History, Layers, BellRing, Zap } from '@lucide/svelte';

  const steps = ['Welcome', 'Twitch', 'OBS', 'Done'] as const;
  let step = $state(0);
  let clientId = $state('');
  let clientError = $state<string | null>(null);
  let finishing = $state(false);

  const themes = [
    { id: 'system', name: 'Match system' },
    { id: 'dark', name: 'Dark' },
    { id: 'light', name: 'Light' },
    { id: 'high_contrast', name: 'High contrast' }
  ];

  function preview(id: string) {
    const spec = BUILT_IN.find((t) => t.id === (id === 'system' ? 'dark' : id))!;
    const t = generateTokens(spec);
    return `--pb:${t['bg-0']};--pp:${t['bg-1']};--pt:${t.text};--pm:${t['text-muted']};--pa:${t.accent};--pr:${t.border}`;
  }

  async function saveClientId() {
    clientError = null;
    try {
      await api.setTwitchClientId(clientId.trim());
      await app.reloadSettings();
      app.twitch = await api.twitchStatus();
    } catch (e) {
      clientError = (e as { message?: string })?.message ?? String(e);
    }
  }

  async function finish() {
    finishing = true;
    if (await attemptOk(() => api.setFirstRunDone(true))) {
      app.page = 'overlays';
      await app.reloadSettings();
    }
    finishing = false;
  }

  const signedIn = $derived(!!app.twitch?.broadcaster);
  const obsOk = $derived(app.obs.state === 'connected');
</script>

<div class="wrap">
  <div class="card">
    <ol class="progress" aria-label="Setup steps">
      {#each steps as s, i (s)}
        <li class:done={i < step} class:now={i === step} aria-current={i === step ? 'step' : undefined}>
          <span class="dot">{#if i < step}<Check size={12} />{:else}{i + 1}{/if}</span>
          <span class="lbl">{s}</span>
        </li>
      {/each}
    </ol>

    <div class="body">
      {#if step === 0}
        <h1>Welcome to Castwright</h1>
        <p class="lead muted">
          Overlays, alerts, chat and automation for your Twitch stream, all in one app. Setup takes about two minutes.
        </p>
        <h2>Pick a look</h2>
        <div class="themes" role="radiogroup" aria-label="Theme">
          {#each themes as t (t.id)}
            <button
              type="button"
              role="radio"
              class="theme"
              aria-checked={app.settings?.appearance.theme === t.id}
              style={preview(t.id)}
              onclick={() => updateAppearance({ theme: t.id })}
            >
              <span class="sw" class:split={t.id === 'system'}>
                <span class="sw-panel"><span class="l1"></span><span class="l2"></span><span class="pill"></span></span>
              </span>
              <span>{t.name}</span>
            </button>
          {/each}
        </div>
        <p class="faint small">You can make your own theme later in Settings.</p>
      {:else if step === 1}
        <h1>Connect Twitch</h1>
        <p class="lead muted">
          Sign in with your channel so Castwright can show follows, subs, cheers, raids and chat. You can add a separate bot
          account later.
        </p>
        {#if app.twitch && !app.twitch.has_client_id}
          <div class="client">
            <label for="fr-client" class="lbl2">Twitch client ID</label>
            <p class="faint small">
              This build needs your own Twitch app. Create one at dev.twitch.tv/console (client type: Public, redirect URL:
              http://localhost) and paste its client ID.
            </p>
            <div class="row gap">
              <input id="fr-client" class="input mono" bind:value={clientId} spellcheck="false" autocomplete="off" />
              <Button onclick={saveClientId} disabled={!clientId.trim()}>Save</Button>
            </div>
            {#if clientError}<p class="err" role="alert">{clientError}</p>{/if}
          </div>
        {/if}
        <TwitchAccounts broadcasterOnly />
      {:else if step === 2}
        <h1>Connect OBS</h1>
        <p class="lead muted">
          Optional. With OBS Studio 28 or newer connected, Castwright can add overlays to your scenes and automation can switch scenes. In OBS, open <b>Tools → WebSocket Server Settings</b>,
          tick <b>Enable WebSocket server</b>, then click <b>Show Connect Info</b> for the password.
        </p>
        <ObsForm compact onsaved={() => (step = 3)} />
      {:else}
        <h1>You're set</h1>
        <p class="lead muted">Here's where things live:</p>
        <ul class="tour">
          <li>
            <Layers size={18} /><div><b>Overlays</b><span class="muted">Design overlays, then use Add to OBS to show them on stream.</span></div>
          </li>
          <li><BellRing size={18} /><div><b>Alerts</b><span class="muted">Follow, sub, cheer and raid alerts with sounds.</span></div></li>
          <li><Zap size={18} /><div><b>Automation</b><span class="muted">Chat commands, timers and reactions to events.</span></div></li>
          <li><History size={18} /><div><b>Activity</b><span class="muted">Chat, event history and your stream title.</span></div></li>
        </ul>
        <div class="status">
          <span class:ok={signedIn}>{signedIn ? '✓' : '–'} Twitch {signedIn ? `signed in as ${app.twitch?.broadcaster?.display_name}` : 'not connected'}</span>
          <span class:ok={obsOk}>{obsOk ? '✓' : '–'} OBS {obsOk ? 'connected' : 'not connected'}</span>
        </div>
        {#if !signedIn || !obsOk}
          <p class="faint small">You can connect these any time in Settings.</p>
        {/if}
      {/if}
    </div>

    <div class="foot row">
      {#if step > 0}
        <Button variant="ghost" onclick={() => step--}><ArrowLeft size={14} />Back</Button>
      {:else}
        <Button variant="ghost" onclick={finish}>Skip setup</Button>
      {/if}
      <div class="grow"></div>
      {#if (step === 1 && !signedIn) || (step === 2 && !obsOk)}
        <Button variant="ghost" onclick={() => step++}>Skip for now</Button>
      {/if}
      {#if step < 3}
        <Button variant="primary" onclick={() => step++} disabled={(step === 1 && !signedIn) || (step === 2 && !obsOk)}>
          {step === 0 ? 'Get started' : 'Next'}<ArrowRight size={14} />
        </Button>
      {:else}
        <Button variant="primary" busy={finishing} onclick={finish}>Open Castwright</Button>
      {/if}
    </div>
  </div>
</div>

<style>
  .wrap {
    flex: 1;
    display: grid;
    place-items: center;
    padding: 32px;
    overflow-y: auto;
  }
  .card {
    width: min(640px, 100%);
    border: 1px solid var(--border);
    border-radius: calc(var(--radius-lg) * 1.4);
    background: var(--bg-1);
    box-shadow: var(--shadow-pop);
    display: flex;
    flex-direction: column;
  }
  .progress {
    list-style: none;
    display: flex;
    gap: 20px;
    padding: 18px 28px;
    border-bottom: 1px solid var(--border);
  }
  .progress li {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
    color: var(--text-faint);
  }
  .dot {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 11px;
    font-weight: 700;
    border: 1px solid var(--border-strong);
  }
  .progress li.now {
    color: var(--text);
    font-weight: 600;
  }
  .progress li.now .dot {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  .progress li.done .dot {
    background: var(--accent-soft);
    border-color: var(--accent-soft);
    color: var(--accent-text);
  }
  .body {
    padding: 28px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 340px;
  }
  h1 {
    font-size: 22px;
    font-weight: 700;
  }
  h2 {
    font-size: 13px;
    font-weight: 650;
    margin-top: 6px;
  }
  .lead {
    font-size: 14px;
    line-height: 1.55;
    max-width: 540px;
  }
  .small {
    font-size: 12px;
    line-height: 1.5;
  }
  .themes {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
  }
  .theme {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 6px 8px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    font-size: 12.5px;
    font-weight: 600;
  }
  .theme[aria-checked='true'] {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .sw {
    height: 64px;
    border-radius: var(--radius);
    background: var(--pb);
    border: 1px solid var(--pr);
    padding: 8px;
    display: flex;
  }
  .sw.split {
    background: linear-gradient(90deg, #f5f5f7 50%, var(--pb) 50%);
  }
  .sw-panel {
    flex: 1;
    background: var(--pp);
    border: 1px solid var(--pr);
    border-radius: 5px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .l1,
  .l2 {
    height: 4px;
    border-radius: 2px;
    background: var(--pt);
    width: 75%;
  }
  .l2 {
    background: var(--pm);
    width: 45%;
  }
  .pill {
    margin-top: auto;
    width: 26px;
    height: 7px;
    border-radius: 3px;
    background: var(--pa);
  }
  .client {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-2);
  }
  .lbl2 {
    font-weight: 600;
    font-size: 13px;
  }
  .gap {
    gap: 8px;
  }
  .err {
    color: var(--danger);
    font-size: 12.5px;
  }
  .tour {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .tour li {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .tour li :global(svg) {
    color: var(--accent-text);
    margin-top: 2px;
    flex: none;
  }
  .tour div {
    display: flex;
    flex-direction: column;
    font-size: 13px;
    gap: 2px;
  }
  .status {
    display: flex;
    gap: 20px;
    font-size: 13px;
    color: var(--text-muted);
    margin-top: 6px;
  }
  .status .ok {
    color: var(--ok);
  }
  .foot {
    padding: 14px 20px;
    border-top: 1px solid var(--border);
    gap: 8px;
  }
  @media (max-width: 620px) {
    .themes {
      grid-template-columns: repeat(2, 1fr);
    }
    .progress .lbl {
      display: none;
    }
  }
</style>
