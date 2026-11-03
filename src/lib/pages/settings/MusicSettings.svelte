<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { isTauri } from '$lib/api/backend';
  import type { MusicSettings } from '$lib/bindings/MusicSettings';
  import type { MusicSource } from '$lib/bindings/MusicSource';
  import { app } from '$lib/state/app.svelte';
  import { watchMusic } from '$lib/state/music-watch';
  import { attempt, toasts } from '$lib/state/toast.svelte';
  import Badge from '$lib/ui/Badge.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Segmented from '$lib/ui/Segmented.svelte';
  import { copyText, openExternal } from '$lib/util/os';
  import { Copy, ExternalLink, FolderOpen } from '@lucide/svelte';
  import Row from './Row.svelte';

  const DEFAULTS: MusicSettings = { source: 'off', spotify_client_id: '', text_file: '', text_format: '{artist} - {title}' };
  const current = $derived(app.settings?.music ?? DEFAULTS);
  const status = $derived(app.music);
  const track = $derived(status?.track ?? null);

  let clientId = $state(app.settings?.music.spotify_client_id ?? '');
  let textFile = $state(app.settings?.music.text_file ?? '');
  let textFormat = $state(app.settings?.music.text_format ?? DEFAULTS.text_format);
  let signingIn = $state(false);

  onMount(() => watchMusic());

  const SOURCES: Array<{ value: MusicSource; label: string }> = [
    { value: 'off', label: 'Off' },
    { value: 'spotify', label: 'Spotify' },
    { value: 'system', label: 'This computer' },
    { value: 'text_file', label: 'Text file' }
  ];

  async function save(next: MusicSettings) {
    const saved = await attempt(() => api.saveMusicSettings(next));
    if (saved && app.settings) app.settings.music = saved;
    return saved;
  }

  async function signIn() {
    signingIn = true;
    const url = await attempt(() => api.spotifyLogin());
    signingIn = false;
    if (url) await openExternal(url);
  }

  async function pickFile() {
    if (!isTauri()) {
      toasts.show('Choosing a file needs the desktop app');
      return;
    }
    const { open } = await import('@tauri-apps/plugin-dialog');
    const file = await open({ title: 'Choose the now playing text file', filters: [{ name: 'Text', extensions: ['txt'] }, { name: 'All files', extensions: ['*'] }] });
    if (typeof file !== 'string') return;
    textFile = file;
    await save({ ...current, text_file: file });
  }

  const stateBadge = $derived.by((): { tone: 'ok' | 'warn' | 'danger' | 'neutral'; text: string } => {
    if (!status || current.source === 'off') return { tone: 'neutral', text: 'Off' };
    if (status.state === 'error') return { tone: 'danger', text: 'Problem' };
    if (status.state === 'connected') return track?.playing ? { tone: 'ok', text: 'Playing' } : { tone: 'neutral', text: 'Nothing playing' };
    return { tone: 'warn', text: 'Not connected' };
  });
</script>

<Row label="Source" hint="Where the song comes from. Use it in a Now playing layer, in {'{{music.title}}'} and in the Song changes trigger.">
  <Segmented label="Music source" value={current.source} options={SOURCES} onchange={(v) => save({ ...current, source: v })} />
</Row>

{#if current.source !== 'off'}
  <div class="now" aria-live="polite">
    <Badge tone={stateBadge.tone}>{stateBadge.text}</Badge>
    {#if track && track.title}
      <span class="song truncate"><b>{track.title}</b>{track.artist ? ` · ${track.artist}` : ''}</span>
      {#if status?.player}<span class="faint small">from {status.player}</span>{/if}
    {/if}
  </div>
  {#if status?.error}<p class="err" role="alert">{status.error}</p>{/if}
{/if}

{#if current.source === 'spotify'}
  <div class="box">
    <p class="muted">Spotify needs an app of your own. It takes two minutes and is free.</p>
    <ol class="steps">
      <li>
        Open the
        <button type="button" class="link" onclick={() => openExternal('https://developer.spotify.com/dashboard')}>Spotify developer dashboard <ExternalLink size={11} /></button>
        and click <b>Create app</b>. Any name works.
      </li>
      <li>
        Under <b>Redirect URIs</b> add
        <span class="mono selectable uri">{status?.redirect_uri || 'http://127.0.0.1:7470/spotify/callback'}</span>
        <button type="button" class="icon" aria-label="Copy redirect URI" onclick={() => copyText(status?.redirect_uri || '', 'Redirect URI copied')}><Copy size={12} /></button>
      </li>
      <li>Tick <b>Web API</b>, save, then copy the app’s <b>Client ID</b> into the box below.</li>
    </ol>
    <div class="row gap">
      <input class="input mono client" placeholder="Client ID" aria-label="Spotify client ID" spellcheck="false" autocomplete="off" bind:value={clientId} />
      <Button disabled={clientId.trim() === current.spotify_client_id} onclick={() => save({ ...current, spotify_client_id: clientId.trim() })}>Save</Button>
    </div>
    <div class="row gap account">
      {#if status?.spotify_user != null}
        <span>Signed in{status.spotify_user ? ` as ${status.spotify_user}` : ''}</span>
        <Button size="sm" variant="ghost" onclick={() => attempt(() => api.spotifyLogout())}>Sign out</Button>
      {:else if status?.login_pending}
        <span class="muted">Finish signing in in your browser…</span>
        <Button size="sm" variant="ghost" onclick={() => attempt(() => api.spotifyCancelLogin())}>Cancel</Button>
        <Button size="sm" onclick={signIn}>Open again</Button>
      {:else}
        <Button variant="primary" busy={signingIn} disabled={!current.spotify_client_id} onclick={signIn}>Sign in with Spotify</Button>
      {/if}
    </div>
    <p class="faint small">If you change the overlay server port, change the redirect URI in your Spotify app too.</p>
  </div>
{:else if current.source === 'system'}
  <div class="box">
    {#if status?.system_supported === false}
      <p class="muted">macOS has no public way for apps to read the playing song. Use Spotify or a text file instead.</p>
    {:else}
      <p class="muted">
        Reads the song from whatever shows in your system media controls: the Spotify app, browsers, VLC, foobar2000 and most other players. When several play, the one playing wins.
      </p>
      <p class="faint small">Windows uses the system media controls. Linux uses MPRIS.</p>
    {/if}
  </div>
{:else if current.source === 'text_file'}
  <div class="box">
    <p class="muted">Many tools can keep the song in a text file: Snip, Tuna for OBS, foobar2000, MusicBee and others.</p>
    <Row label="File">
      <input class="input mono path" placeholder="C:\Music\nowplaying.txt" aria-label="Text file" spellcheck="false" bind:value={textFile} onchange={() => save({ ...current, text_file: textFile.trim() })} />
      <Button size="sm" onclick={pickFile}><FolderOpen size={14} />Browse…</Button>
    </Row>
    <Row label="Format" hint={'How the text splits up. Use {title}, {artist} and {album}. \\n is a new line.'}>
      <input class="input mono format" aria-label="Text format" spellcheck="false" bind:value={textFormat} onchange={() => save({ ...current, text_format: textFormat })} />
    </Row>
    <p class="faint small">Castwright checks the file every second. No progress bar: text files don’t have the time.</p>
  </div>
{/if}

<style>
  .now {
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 760px;
    font-size: 13px;
    min-width: 0;
  }
  .song {
    min-width: 0;
  }
  .box {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 760px;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-1);
    font-size: 13px;
    line-height: 1.5;
  }
  .steps {
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .uri {
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--bg-2);
  }
  .mono {
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .client {
    width: 320px;
  }
  .path {
    width: 340px;
  }
  .format {
    width: 240px;
  }
  .gap {
    gap: 8px;
  }
  .account {
    font-size: 13px;
  }
  .link {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    color: var(--accent-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .icon {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 20px;
    vertical-align: middle;
    border-radius: 5px;
    color: var(--text-muted);
  }
  .icon:hover {
    background: var(--bg-2);
    color: var(--text);
  }
  .err {
    color: var(--danger);
    font-size: 12.5px;
    max-width: 760px;
  }
  .small {
    font-size: 12px;
  }
</style>
