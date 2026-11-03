<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { app, type Page } from '$lib/state/app.svelte';
  import { isTauri } from '$lib/api/backend';
  import { on } from '$lib/api';
  import { flushAll } from '$lib/state/flush';
  import { stepZoom } from '$lib/state/zoom';
  import { toasts } from '$lib/state/toast.svelte';
  import { handleExternalLinks } from '$lib/util/os';
  import { updateAppearance } from '$lib/pages/settings/theme-settings.svelte';
  import Toasts from '$lib/ui/Toasts.svelte';
  import StatusBar from '$lib/shell/StatusBar.svelte';
  // Editors are loaded when first opened so start-up stays quick.
  const loadOverlays = () => import('$lib/pages/overlays/Overlays.svelte');
  const loadAlerts = () => import('$lib/pages/alerts/Alerts.svelte');
  const loadAutomation = () => import('$lib/pages/automation/Automation.svelte');
  const loadInteract = () => import('$lib/pages/interact/Interact.svelte');
  import Activity from '$lib/pages/activity/Activity.svelte';
  import SettingsPage from '$lib/pages/settings/Settings.svelte';
  import FirstRun from '$lib/pages/firstrun/FirstRun.svelte';
  import { Layers, BellRing, Zap, History, Settings, Search, Vote } from '@lucide/svelte';
  import CommandPalette from '$lib/shell/CommandPalette.svelte';
  import ShortcutsDialog from '$lib/shell/ShortcutsDialog.svelte';
  import GoLiveDialog from '$lib/shell/GoLiveDialog.svelte';
  import SummaryDialog from '$lib/sessions/SummaryDialog.svelte';
  import WhatsNewDialog from '$lib/whatsnew/WhatsNewDialog.svelte';
  import UpdateDialog from '$lib/shell/UpdateDialog.svelte';
  import HealthDialog from '$lib/health/HealthDialog.svelte';
  import BugReportDialog from '$lib/health/BugReportDialog.svelte';
  import { health } from '$lib/health/store.svelte';
  import { sounds } from '$lib/soundboard/player.svelte';
  import { golive } from '$lib/state/golive.svelte';
  import { loadPref, savePref } from '$lib/state/persist';

  const pages: Array<{ id: Page; label: string; icon: typeof Layers }> = [
    { id: 'overlays', label: 'Overlays', icon: Layers },
    { id: 'alerts', label: 'Alerts', icon: BellRing },
    { id: 'automation', label: 'Automation', icon: Zap },
    { id: 'activity', label: 'Activity', icon: History },
    { id: 'interact', label: 'Interact', icon: Vote }
  ];

  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);

  let paletteOpen = $state(false);
  let shortcutsOpen = $state(false);

  // Reopen on the page used last time.
  const lastPage = loadPref<Page>('page', 'overlays');
  if (['overlays', 'alerts', 'automation', 'activity', 'interact', 'settings'].includes(lastPage)) app.page = lastPage;
  $effect(() => savePref('page', app.page));

  $effect(() => {
    if (!app.ready) return;
    const live = app.obs.stream.active || !!app.twitch?.stream.live;
    untrack(() => golive.watchLive(live));
  });

  $effect(() => {
    if (!app.ready) return;
    untrack(() => health.start());
    return () => health.stop();
  });

  // Soundboard sounds can start from hotkeys, chat or a Stream Deck on any page.
  $effect(() => {
    if (app.ready) untrack(() => void sounds.start());
  });

  // A global hotkey can open the go-live check while another app has focus.
  $effect(() => {
    if (!app.ready) return;
    let unlisten: (() => void) | undefined;
    let gone = false;
    void on('cw://golive-open', () => golive.show()).then((u) => (gone ? u() : (unlisten = u)));
    return () => {
      gone = true;
      unlisten?.();
    };
  });

  onMount(() => {
    app.init();
    // Save pending edits before the window closes.
    let unlistenClose: (() => void) | undefined;
    if (isTauri()) {
      import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
        getCurrentWindow()
          .onCloseRequested(() => flushAll())
          .then((u) => (unlistenClose = u))
      );
    }
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      // Zoom: Ctrl + / Ctrl - / Ctrl 0, saved as the interface size.
      const zoomKey = e.key === '=' || e.key === '+' ? 1 : e.key === '-' || e.key === '_' ? -1 : e.key === '0' ? 0 : null;
      if (zoomKey !== null && app.settings) {
        e.preventDefault();
        const cur = app.settings.appearance.ui_scale;
        const next = zoomKey === 0 ? 100 : stepZoom(cur, zoomKey);
        if (next !== cur) {
          updateAppearance({ ui_scale: next });
          toasts.show(`Zoom ${next}%`, 'info', 1500, 'zoom');
        }
        return;
      }
      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        shortcutsOpen = false;
        paletteOpen = !paletteOpen;
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        paletteOpen = false;
        shortcutsOpen = !shortcutsOpen;
        return;
      }
      if (e.shiftKey) return;
      const all: Page[] = [...pages.map((p) => p.id), 'settings'];
      const i = Number(e.key) - 1;
      if (i >= 0 && i < all.length) {
        e.preventDefault();
        app.page = all[i]!;
      } else if (e.key === ',') {
        e.preventDefault();
        app.page = 'settings';
      }
    };
    window.addEventListener('keydown', onKey);
    const stopLinks = handleExternalLinks();
    return () => {
      window.removeEventListener('keydown', onKey);
      stopLinks();
      unlistenClose?.();
    };
  });
</script>

{#snippet loadFailed()}
  <div class="center">
    <div class="fatal">
      <h1>This page couldn't load</h1>
      <button type="button" onclick={() => location.reload()}>Reload</button>
    </div>
  </div>
{/snippet}

{#if app.fatal}
  <div class="center">
    <div class="fatal">
      <h1>Castwright couldn't start</h1>
      <p class="muted selectable">{app.fatal}</p>
      <button type="button" onclick={() => location.reload()}>Try again</button>
    </div>
  </div>
{:else if !app.ready}
  <div class="center" aria-busy="true">
    <div class="splash">
      <svg width="40" height="40" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M80.64 24.29A40 40 0 1 0 80.64 75.71" />
        <path d="M31 38L41 66L50 46L59 66L69 38" />
      </svg>
      <span class="sr-only">Loading</span>
    </div>
  </div>
{:else if app.settings && !app.settings.first_run_done}
  <div class="first-run" class:mac={isMac}>
    {#if isMac}<div class="drag" data-tauri-drag-region></div>{/if}
    <FirstRun />
  </div>
{:else}
  <div class="shell" class:mac={isMac}>
    {#if isMac}<div class="drag" data-tauri-drag-region></div>{/if}
    <nav class="rail" aria-label="Main sections">
      <div class="logo" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M80.64 24.29A40 40 0 1 0 80.64 75.71" />
          <path d="M31 38L41 66L50 46L59 66L69 38" />
        </svg>
      </div>
      <button type="button" class="nav search" title="Search and commands ({isMac ? '⌘K' : 'Ctrl+K'})" onclick={() => (paletteOpen = true)}>
        <Search size={18} strokeWidth={1.8} />
        <span class="nav-label">Search</span>
      </button>
      {#each pages as p, i (p.id)}
        <button
          type="button"
          class="nav"
          class:on={app.page === p.id}
          aria-current={app.page === p.id ? 'page' : undefined}
          title="{p.label} ({isMac ? `⌘${i + 1}` : `Ctrl+${i + 1}`})"
          onclick={() => (app.page = p.id)}
        >
          <p.icon size={20} strokeWidth={1.8} />
          <span class="nav-label">{p.label}</span>
        </button>
      {/each}
      <div class="grow"></div>
      <button
        type="button"
        class="nav"
        class:on={app.page === 'settings'}
        aria-current={app.page === 'settings' ? 'page' : undefined}
        title="Settings ({isMac ? '⌘,' : 'Ctrl+,'})"
        onclick={() => (app.page = 'settings')}
      >
        <Settings size={20} strokeWidth={1.8} />
        <span class="nav-label">Settings</span>
      </button>
    </nav>
    <main class="page">
      {#if app.page === 'overlays'}{#await loadOverlays() then m}<m.default />{:catch}{@render loadFailed()}{/await}
      {:else if app.page === 'alerts'}{#await loadAlerts() then m}<m.default />{:catch}{@render loadFailed()}{/await}
      {:else if app.page === 'automation'}{#await loadAutomation() then m}<m.default />{:catch}{@render loadFailed()}{/await}
      {:else if app.page === 'activity'}<Activity />
      {:else if app.page === 'interact'}{#await loadInteract() then m}<m.default />{:catch}{@render loadFailed()}{/await}
      {:else}<SettingsPage />{/if}
    </main>
    <StatusBar />
  </div>
{/if}
<Toasts />
{#if app.ready}
  <CommandPalette bind:open={paletteOpen} onshortcuts={() => (shortcutsOpen = true)} />
  <ShortcutsDialog bind:open={shortcutsOpen} />
  <GoLiveDialog />
  <SummaryDialog />
  <WhatsNewDialog />
  <UpdateDialog />
  <HealthDialog />
  <BugReportDialog />
{/if}

<style>
  .center {
    height: calc(100vh / var(--css-zoom, 1));
    display: grid;
    place-items: center;
  }
  .splash {
    color: var(--accent-text, #9db8ff);
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.4;
    }
  }
  .fatal {
    max-width: 480px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 24px;
  }
  .fatal button {
    align-self: flex-start;
    padding: 6px 14px;
    border-radius: 8px;
    cursor: pointer;
  }
  .shell {
    display: grid;
    /* The rail grows to fit its longest label, whatever the font. */
    grid-template-columns: minmax(var(--rail-w), max-content) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) auto;
    height: calc(100vh / var(--css-zoom, 1));
  }
  .shell.mac {
    grid-template-rows: 28px minmax(0, 1fr) auto;
  }
  .drag {
    grid-column: 1 / -1;
    height: 28px;
  }
  .first-run {
    height: calc(100vh / var(--css-zoom, 1));
    display: flex;
    flex-direction: column;
  }
  .rail {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
    padding: 10px 7px;
    overflow: hidden auto;
    scrollbar-width: none;
    border-right: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-1) 70%, transparent);
    grid-row: span 1;
  }
  .logo {
    height: 36px;
    display: grid;
    place-items: center;
    color: var(--accent-text);
    margin-bottom: 6px;
  }
  .nav {
    position: relative;
    min-width: 46px;
    min-height: 46px;
    padding: 5px 4px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    border: 0;
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: background 0.12s var(--ease), color 0.12s var(--ease);
  }
  .nav.search {
    margin-bottom: 8px;
  }
  .nav.search::after {
    content: '';
    position: absolute;
    bottom: -5px;
    left: 10px;
    right: 10px;
    height: 1px;
    background: var(--border);
  }
  .nav:hover {
    background: var(--bg-3);
    color: var(--text);
  }
  .nav.on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .nav.on::before {
    content: '';
    position: absolute;
    left: -7px;
    top: 12px;
    bottom: 12px;
    width: 3px;
    border-radius: 3px;
    background: var(--accent);
  }
  .nav-label {
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.01em;
    line-height: 1.2;
    white-space: nowrap;
  }
  .page {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .shell :global(.status) {
    grid-column: 1 / -1;
  }
</style>
