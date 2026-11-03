<script lang="ts">
  import { whatsNew } from '$lib/whatsnew/whatsnew.svelte';
  import { onMount } from 'svelte';
  import { app } from '$lib/state/app.svelte';
  import { api } from '$lib/api';
  import { isTauri } from '$lib/api/backend';
  import { updates } from '$lib/state/updates.svelte';
  import { attempt, attemptOk, toasts } from '$lib/state/toast.svelte';
  import { copyText, openExternal, reveal } from '$lib/util/os';
  import Button from '$lib/ui/Button.svelte';
  import Badge from '$lib/ui/Badge.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import Field from '$lib/ui/Field.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import ObsForm from '$lib/widgets/ObsForm.svelte';
  import TwitchAccounts from '$lib/widgets/TwitchAccounts.svelte';
  import Section from './Section.svelte';
  import Row from './Row.svelte';
  import Appearance from './Appearance.svelte';
  import GoLiveSettings from './GoLiveSettings.svelte';
  import SummarySettings from './SummarySettings.svelte';
  import AdSettings from './AdSettings.svelte';
  import DiscordSettings from './DiscordSettings.svelte';
  import MusicSettings from './MusicSettings.svelte';
  import ChatRulesForm from '$lib/widgets/chat/ChatRulesForm.svelte';
  import { defaultChatRules } from '$lib/overlay/chat-filters';
  import type { ChatRules } from '$lib/bindings/ChatRules';
  import Backups from './Backups.svelte';
  import Hotkeys from './Hotkeys.svelte';
  import { health } from '$lib/health/store.svelte';
  import { REPO } from '$lib/health/health';
  import { Copy, Eye, EyeOff, FolderOpen, RefreshCw, ExternalLink, TriangleAlert } from '@lucide/svelte';

  const SITE = 'https://castwright.sinist3r.lol';

  const sections = [
    { id: 'general', label: 'General' },
    { id: 'obs', label: 'OBS' },
    { id: 'twitch', label: 'Twitch' },
    { id: 'chat', label: 'Chat filters' },
    { id: 'music', label: 'Music' },
    { id: 'server', label: 'Overlay server' },
    { id: 'golive', label: 'Go-live check' },
    { id: 'ads', label: 'Ads' },
    { id: 'discord', label: 'Discord' },
    { id: 'hotkeys', label: 'Hotkeys' },
    { id: 'summary', label: 'Stream summary' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'backups', label: 'Backups and data' },
    { id: 'about', label: 'About' }
  ];
  let active = $state('general');
  let scroller: HTMLElement | undefined = $state();

  // General
  let projectName = $state(app.project?.name ?? '');
  let projectDir = $state(app.info?.project_dir ?? '');
  let dirChanged = $state(false);

  // Twitch client id
  let clientId = $state(app.settings?.twitch.client_id ?? '');
  let clientIdError = $state<string | null>(null);

  // Server
  let port = $state(app.settings?.server.port ?? 7470);
  let allowLan = $state(app.settings?.server.allow_lan ?? false);
  let showToken = $state(false);
  let confirmToken = $state(false);
  let restarting = $state(false);
  const portValid = $derived(Number.isInteger(port) && port >= 1024 && port <= 65535);
  const serverDirty = $derived(port !== app.settings?.server.port || allowLan !== app.settings?.server.allow_lan);

  // Portable mode
  let portableOpen = $state(false);
  let portableStep = $state<'confirm' | 'copying' | 'done'>('confirm');
  let portableDir = $state('');

  async function makePortable() {
    portableStep = 'copying';
    const dir = await attempt(() => api.makePortable());
    if (dir) {
      portableDir = dir;
      portableStep = 'done';
      portableOpen = true;
      app.info = await api.appInfo();
    } else portableStep = 'confirm';
  }

  // Data
  let confirmClear = $state(false);
  let confirmSession = $state(false);

  // The active section is the last one whose heading is in the top third of the view.
  function track() {
    if (!scroller) return;
    const line = scroller.getBoundingClientRect().top + scroller.clientHeight * 0.35;
    let current = sections[0]!.id;
    for (const s of sections) {
      const el = document.getElementById(s.id)?.querySelector('h2');
      if (el && el.getBoundingClientRect().top <= line) current = s.id;
    }
    active = current;
  }

  onMount(() => {
    const el = scroller;
    el?.addEventListener('scroll', track, { passive: true });
    return () => el?.removeEventListener('scroll', track);
  });

  function go(id: string) {
    active = id;
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function saveName() {
    const name = projectName.trim();
    if (!name || name === app.project?.name) {
      projectName = app.project?.name ?? '';
      return;
    }
    await attemptOk(() => api.renameProject(name), 'Project renamed');
    await app.reloadProject();
    projectName = app.project?.name ?? name;
  }

  async function pickDir() {
    if (!isTauri()) {
      toasts.show('Choosing a folder needs the desktop app');
      return;
    }
    const { open } = await import('@tauri-apps/plugin-dialog');
    const dir = await open({ directory: true, title: 'Choose a project folder' });
    if (typeof dir !== 'string') return;
    if (await attemptOk(() => api.setProjectDir(dir))) {
      projectDir = dir;
      dirChanged = true;
    }
  }

  async function saveRules(next: ChatRules) {
    const saved = await attempt(() => api.saveChatRules(next));
    if (saved && app.project) app.project.chat_rules = saved;
  }

  async function saveClientId() {
    clientIdError = null;
    const id = clientId.trim();
    try {
      await api.setTwitchClientId(id);
      await app.reloadSettings();
      app.twitch = await api.twitchStatus();
      toasts.success(id ? 'Client ID saved' : 'Using the built-in client ID');
    } catch (e) {
      clientIdError = (e as { message?: string })?.message ?? String(e);
    }
  }

  async function applyServer() {
    restarting = true;
    const info = await attempt(() => api.restartServer(port, allowLan));
    if (info) {
      app.server = info;
      await app.reloadSettings();
      if (info.error) toasts.error(info.error);
      else toasts.success(`Overlay server running on port ${info.port}`);
    }
    restarting = false;
  }

  async function newToken() {
    confirmToken = false;
    const info = await attempt(() => api.regenerateToken(), 'New link secret created');
    if (info) {
      app.server = info;
      await app.reloadSettings();
    }
  }

  let checking = $state(false);
  async function checkUpdates() {
    checking = true;
    await updates.check(app.info?.version ?? '', true);
    checking = false;
    if (updates.available) updates.open = true;
    else toasts.success(`You have the latest version (${app.info?.version}).`);
  }

  async function setAutoInstall(on: boolean) {
    const saved = await attempt(() => api.saveUpdateSettings({ ...updates.settings, auto_install: on }));
    if (!saved) return;
    updates.settings = saved;
    if (app.settings) app.settings.updates = saved;
    const p = updates.phase;
    if (on && p.kind === 'available' && p.canInstall) void updates.download();
  }

  const maskedToken = $derived(app.server ? app.server.token.slice(0, 4) + '•'.repeat(12) : '');
</script>

<div class="settings">
  <nav class="toc" aria-label="Settings sections">
    <div class="eyebrow pad">Settings</div>
    {#each sections as s (s.id)}
      <button type="button" class="toc-item" class:on={active === s.id} aria-current={active === s.id ? 'true' : undefined} onclick={() => go(s.id)}>
        {s.label}
      </button>
    {/each}
  </nav>

  <div class="scroll" bind:this={scroller}>
    <div class="content">
      <Section id="general" title="General" description="Your project holds every overlay, alert, action and uploaded file.">
        <Field label="Project name" for="project-name">
          <input
            id="project-name"
            class="input name"
            maxlength="80"
            bind:value={projectName}
            onblur={saveName}
            onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          />
        </Field>
        <Row label="Project folder" hint={dirChanged ? 'Restart Castwright to switch to this folder.' : undefined}>
          <span class="path mono selectable truncate" title={projectDir}>{projectDir}</span>
          <Button size="sm" variant="ghost" onclick={() => reveal(projectDir)} aria-label="Show in file manager"><FolderOpen size={14} /></Button>
          <Button size="sm" onclick={pickDir}>Change…</Button>
        </Row>
        <Row label="Setup guide" hint="Walk through the first-time setup again.">
          <Button size="sm" onclick={() => attempt(() => api.setFirstRunDone(false)).then(() => app.reloadSettings())}>Run setup</Button>
        </Row>
      </Section>

      <Section
        id="obs"
        title="OBS"
        description="Castwright controls OBS Studio 28 or newer through its built-in WebSocket server. In OBS open Tools → WebSocket Server Settings and tick Enable WebSocket server."
      >
        <ObsForm />
      </Section>

      <Section id="twitch" title="Twitch" description="Sign in so Castwright can receive follows, subs, cheers, raids and chat, and update your stream info.">
        <TwitchAccounts />
        <details class="advanced">
          <summary>Use your own Twitch app</summary>
          <p class="muted">
            {app.info?.built_in_client_id
              ? 'This build has a client ID built in, so this is optional.'
              : "This build doesn't include a client ID, so you need your own."}
            Create an app at
            <button type="button" class="link" onclick={() => openExternal('https://dev.twitch.tv/console/apps')}>dev.twitch.tv/console <ExternalLink size={11} /></button>
            with the client type set to <b>Public</b> and the redirect URL <span class="mono">http://localhost</span>, then paste its client ID here.
          </p>
          <div class="row gap client">
            <input
              class="input mono"
              placeholder={app.info?.built_in_client_id ? 'Built-in client ID' : 'Client ID'}
              bind:value={clientId}
              aria-label="Twitch client ID"
              aria-invalid={!!clientIdError}
              spellcheck="false"
              autocomplete="off"
            />
            <Button onclick={saveClientId} disabled={clientId.trim() === (app.settings?.twitch.client_id ?? '')}>Save</Button>
          </div>
          {#if clientIdError}<p class="err" role="alert">{clientIdError}</p>{/if}
          <p class="faint small">Changing it signs you out of both accounts.</p>
        </details>
      </Section>

      <Section
        id="chat"
        title="Chat filters"
        description="Hide bots, commands and unwanted words, and highlight messages you shouldn't miss. The chat panel and chat layers use these unless you turn them off there."
      >
        <ChatRulesForm rules={app.project?.chat_rules ?? defaultChatRules()} uid="settings-chat" onchange={saveRules} />
      </Section>

      <Section id="music" title="Music" description="Show the song you're playing in overlays and react when it changes.">
        <MusicSettings />
      </Section>

      <Section id="server" title="Overlay server" description="OBS loads your overlays from a small web server inside Castwright. It only runs while the app is open.">
        <Row label="Status">
          {#if app.server?.running}
            <Badge tone="ok">Running</Badge>
            <span class="mono selectable">{app.server.base_url}</span>
          {:else}
            <Badge tone="danger">Stopped</Badge>
          {/if}
        </Row>
        {#if app.server?.error}<p class="err" role="alert">{app.server.error}</p>{/if}
        <Row label="Port" hint="Change it if another program already uses this one. 1024 to 65535.">
          <input class="input mono port" type="number" min="1024" max="65535" bind:value={port} aria-label="Port" aria-invalid={!portValid} />
        </Row>
        <Row label="Allow other devices" hint="Lets a phone or second PC on your network open overlays and run actions. Leave off unless you need it.">
          <Switch label="Allow other devices" bind:checked={allowLan} />
        </Row>
        {#if serverDirty}
          <div class="row gap">
            <Button variant="primary" busy={restarting} disabled={!portValid} onclick={applyServer}>Apply and restart server</Button>
            <Button variant="ghost" onclick={() => ((port = app.settings?.server.port ?? 7470), (allowLan = app.settings?.server.allow_lan ?? false))}>Undo</Button>
          </div>
        {/if}
        <Row label="Link secret" hint="Part of every overlay link so other programs can't read your overlays.">
          <span class="mono selectable token">{showToken ? app.server?.token : maskedToken}</span>
          <Button size="sm" variant="ghost" aria-label={showToken ? 'Hide secret' : 'Show secret'} onclick={() => (showToken = !showToken)}>
            {#if showToken}<EyeOff size={14} />{:else}<Eye size={14} />{/if}
          </Button>
          <Button size="sm" variant="ghost" aria-label="Copy secret" onclick={() => copyText(app.server?.token ?? '', 'Secret copied')}><Copy size={14} /></Button>
          <Button size="sm" onclick={() => (confirmToken = true)}><RefreshCw size={14} />New secret</Button>
        </Row>
      </Section>

      <Section id="golive" title="Go-live check" description="Checks OBS, overlays, Twitch and alerts in a few seconds. Open it from the status bar or the command palette.">
        <GoLiveSettings />
      </Section>

      <Section id="ads" title="Ads" description="Shows the next ad in the status bar while you're live. Click it to snooze or run an ad.">
        <AdSettings />
      </Section>

      <Section
        id="discord"
        title="Discord"
        description="Post to your Discord when you go live, and a summary when you end. Webhook links stay in your system keychain and are never in backups or exports."
      >
        <DiscordSettings />
      </Section>

      <Section
        id="hotkeys"
        title="Hotkeys"
        description="Global hotkeys work even while a game or another app has focus. Click a box and press the keys you want."
      >
        <Hotkeys />
      </Section>

      <Section id="summary" title="Stream summary" description="Made each time a stream ends. Find past streams under Activity → Sessions.">
        <SummarySettings />
      </Section>

      <Section id="appearance" title="Appearance" description="Pick a theme or make your own. Every built-in theme meets WCAG AA contrast.">
        <Appearance />
      </Section>

      <Section
        id="backups"
        title="Backups and data"
        description="Castwright backs up your project when it starts, once a day while it runs, and before a restore or import. Backups hold overlays, alerts, actions and saved variables. Uploaded files, passwords and sign-ins are never included."
      >
        <Backups onrestored={(p) => (projectName = p.name)} />
        <Row label="Session counters" hint="Sets this stream's follow, sub, bit and raid totals back to zero.">
          <Button size="sm" onclick={() => (confirmSession = true)}>Reset</Button>
        </Row>
        <Row label="Event history" hint="Deletes saved events. Overlays like recent events lists will be empty.">
          <Button size="sm" variant="danger" onclick={() => (confirmClear = true)}>Clear history</Button>
        </Row>
      </Section>

      <Section id="about" title="About">
        <div class="about">
          <div class="brand">
            <svg width="34" height="34" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M80.64 24.29A40 40 0 1 0 80.64 75.71" />
              <path d="M31 38L41 66L50 46L59 66L69 38" />
            </svg>
            <div>
              <b>Castwright</b>
              <div class="faint small">Version {app.info?.version} · {app.info?.os}</div>
            </div>
            {#if app.info?.portable}<Badge tone="ok">Portable mode</Badge>{/if}
          </div>
          <dl>
            <dt>{app.info?.portable ? 'Data folder' : 'Settings folder'}</dt>
            <dd class="row gap">
              <span class="mono selectable">{app.info?.config_dir}</span>
              <Button size="sm" variant="ghost" onclick={() => reveal(app.info?.config_dir ?? '')} aria-label="Show in file manager"><FolderOpen size={14} /></Button>
            </dd>
          </dl>
          {#if app.info?.portable}
            <p class="warn-note">
              <TriangleAlert size={14} /> Passwords and sign-ins are saved in secrets.json in the data folder. It isn't encrypted, so keep the drive somewhere safe.
            </p>
          {:else if app.info?.secrets_in_file}
            <p class="warn-note">
              <TriangleAlert size={14} /> No system keychain was found, so passwords and sign-ins are saved in a private file in the settings folder.
            </p>
          {/if}
          {#if !app.info?.portable}
            <Row
              label="Portable mode"
              hint={portableDir
                ? 'Data copied. Restart Castwright to use it.'
                : (app.info?.portable_blocked ?? 'Copies your settings, project, backups and sign-ins into a data folder next to Castwright, for running it from a USB drive.')}
            >
              <Button size="sm" disabled={!!app.info?.portable_blocked || !!portableDir} onclick={() => ((portableStep = 'confirm'), (portableOpen = true))}>Make portable…</Button>
            </Row>
          {/if}
          <Row label="Install updates automatically" hint="Downloads new versions in the background. They install the next time Castwright closes or restarts.">
            <Switch label="Install updates automatically" checked={updates.settings.auto_install} onchange={setAutoInstall} />
          </Row>
          <Row label="Update channel" hint="Only stable releases for now.">
            <Badge>Stable</Badge>
          </Row>
          <div class="row gap">
            <Button size="sm" busy={checking} onclick={checkUpdates}>Check for updates</Button>
            <Button size="sm" onclick={() => whatsNew.show(app.info?.version ?? '')}>What's new</Button>
            <Button size="sm" onclick={() => health.show()}>Health</Button>
            <Button size="sm" onclick={() => health.showReport()}>Save bug report…</Button>
            <Button size="sm" variant="ghost" onclick={() => openExternal(SITE)}>Guide <ExternalLink size={12} /></Button>
            <Button size="sm" variant="ghost" onclick={() => openExternal(REPO)}>Source code <ExternalLink size={12} /></Button>
            <Button size="sm" variant="ghost" onclick={() => openExternal(`${REPO}/issues`)}>Report a problem <ExternalLink size={12} /></Button>
          </div>
          <p class="faint small">MIT licence. Not affiliated with Twitch or OBS.</p>
        </div>
      </Section>
    </div>
  </div>
</div>

<Dialog bind:open={confirmToken} title="Create a new link secret?" description="Overlay links you already added to OBS stop working. Use Add to OBS or copy the new links afterwards." width={440}>
  {#snippet footer()}
    <Button onclick={() => (confirmToken = false)}>Cancel</Button>
    <Button variant="danger" onclick={newToken}>Create new secret</Button>
  {/snippet}
</Dialog>

<Dialog
  bind:open={portableOpen}
  title={portableStep === 'done' ? 'Restart to finish' : 'Make Castwright portable?'}
  width={480}
>
  {#if portableStep === 'done'}
    <p class="dialog-text">Your data was copied to <span class="mono selectable">{portableDir}</span>. Castwright uses it after a restart.</p>
  {:else}
    <ul class="dialog-text steps">
      <li>Copies settings, the default project, backups and sign-ins to a <b>data</b> folder in <span class="mono selectable">{app.info?.app_folder}</span>.</li>
      <li>Your current data stays where it is, so nothing is lost.</li>
      <li>Sign-ins are saved there in a plain file. Keep the drive safe.</li>
    </ul>
  {/if}
  {#snippet footer()}
    {#if portableStep === 'done'}
      <Button onclick={() => (portableOpen = false)}>Later</Button>
      <Button variant="primary" onclick={() => attempt(() => api.restartApp())}>Restart now</Button>
    {:else}
      <Button disabled={portableStep === 'copying'} onclick={() => (portableOpen = false)}>Cancel</Button>
      <Button variant="primary" busy={portableStep === 'copying'} onclick={makePortable}>Copy data</Button>
    {/if}
  {/snippet}
</Dialog>

<Dialog bind:open={confirmSession} title="Reset session counters?" width={400}>
  {#snippet footer()}
    <Button onclick={() => (confirmSession = false)}>Cancel</Button>
    <Button variant="primary" onclick={() => ((confirmSession = false), attempt(() => api.resetSession(), 'Counters reset'))}>Reset</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={confirmClear} title="Clear event history?" description="This can't be undone." width={400}>
  {#snippet footer()}
    <Button onclick={() => (confirmClear = false)}>Cancel</Button>
    <Button
      variant="danger"
      onclick={async () => {
        confirmClear = false;
        if (await attemptOk(() => api.clearHistory(), 'History cleared')) app.feed = [];
      }}>Clear history</Button
    >
  {/snippet}
</Dialog>

<style>
  .settings {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .toc {
    width: 200px;
    flex: none;
    padding: 16px 10px;
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .pad {
    padding: 0 10px 8px;
  }
  .toc-item {
    text-align: left;
    padding: 7px 10px;
    border-radius: var(--radius);
    font-size: 13px;
    color: var(--text-muted);
  }
  .toc-item:hover {
    background: var(--bg-2);
    color: var(--text);
  }
  .toc-item.on {
    background: var(--bg-3);
    color: var(--text);
    font-weight: 600;
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
  }
  .content {
    max-width: 1040px;
    padding: 0 40px 80px;
  }
  .name {
    max-width: 360px;
  }
  .path {
    max-width: 320px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .mono {
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .port {
    width: 110px;
  }
  .token {
    color: var(--text-muted);
  }
  .gap {
    gap: 8px;
  }
  .advanced {
    max-width: 640px;
    font-size: 13px;
  }
  .advanced summary {
    cursor: pointer;
    color: var(--accent-text);
    font-size: 13px;
    width: max-content;
  }
  .advanced[open] summary {
    margin-bottom: 10px;
  }
  .advanced p {
    line-height: 1.5;
  }
  .client {
    margin: 10px 0 6px;
    max-width: 480px;
  }
  .link {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    color: var(--accent-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .err {
    color: var(--danger);
    font-size: 12.5px;
  }
  .small {
    font-size: 12px;
  }
  .about {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .brand {
    display: flex;
    gap: 12px;
    align-items: center;
    color: var(--accent-text);
  }
  .brand b {
    color: var(--text);
    font-size: 15px;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 16px;
    font-size: 13px;
  }
  dt {
    color: var(--text-muted);
  }
  .dialog-text {
    font-size: 13px;
    line-height: 1.5;
  }
  .steps {
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .warn-note {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    color: var(--warn);
    font-size: 12.5px;
    max-width: 620px;
  }
  @media (max-width: 1100px) {
    .toc {
      width: 170px;
    }
    .content {
      padding: 0 24px 80px;
    }
  }
</style>
