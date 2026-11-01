<script lang="ts">
  import { onMount } from 'svelte';
  import { app, type Page } from '$lib/state/app.svelte';
  import Toasts from '$lib/ui/Toasts.svelte';
  import StatusBar from '$lib/shell/StatusBar.svelte';
  import Studio from '$lib/pages/studio/Studio.svelte';
  // Editors are loaded when first opened so start-up stays quick.
  const loadOverlays = () => import('$lib/pages/overlays/Overlays.svelte');
  const loadAlerts = () => import('$lib/pages/alerts/Alerts.svelte');
  const loadAutomation = () => import('$lib/pages/automation/Automation.svelte');
  import Activity from '$lib/pages/activity/Activity.svelte';
  import SettingsPage from '$lib/pages/settings/Settings.svelte';
  import FirstRun from '$lib/pages/firstrun/FirstRun.svelte';
  import { MonitorPlay, Layers, BellRing, Zap, History, Settings } from '@lucide/svelte';

  const pages: Array<{ id: Page; label: string; icon: typeof MonitorPlay }> = [
    { id: 'studio', label: 'Studio', icon: MonitorPlay },
    { id: 'overlays', label: 'Overlays', icon: Layers },
    { id: 'alerts', label: 'Alerts', icon: BellRing },
    { id: 'automation', label: 'Automation', icon: Zap },
    { id: 'activity', label: 'Activity', icon: History }
  ];

  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);

  onMount(() => {
    app.init();
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
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
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

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
      <svg width="40" height="40" viewBox="0 0 64 64" aria-hidden="true">
        <rect x="6" y="10" width="52" height="36" rx="9" fill="none" stroke="currentColor" stroke-width="4" />
        <path d="M22 56h20" stroke="currentColor" stroke-width="4" stroke-linecap="round" />
        <circle cx="32" cy="28" r="7" fill="currentColor" />
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
        <svg width="22" height="22" viewBox="0 0 64 64">
          <rect x="6" y="10" width="52" height="36" rx="9" fill="none" stroke="currentColor" stroke-width="5" />
          <path d="M22 56h20" stroke="currentColor" stroke-width="5" stroke-linecap="round" />
          <circle cx="32" cy="28" r="7" fill="currentColor" />
        </svg>
      </div>
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
      {#if app.page === 'studio'}<Studio />
      {:else if app.page === 'overlays'}{#await loadOverlays() then m}<m.default />{/await}
      {:else if app.page === 'alerts'}{#await loadAlerts() then m}<m.default />{/await}
      {:else if app.page === 'automation'}{#await loadAutomation() then m}<m.default />{/await}
      {:else if app.page === 'activity'}<Activity />
      {:else}<SettingsPage />{/if}
    </main>
    <StatusBar />
  </div>
{/if}
<Toasts />

<style>
  .center {
    height: 100vh;
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
    grid-template-columns: var(--rail-w) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) auto;
    height: 100vh;
  }
  .shell.mac {
    grid-template-rows: 28px minmax(0, 1fr) auto;
  }
  .drag {
    grid-column: 1 / -1;
    height: 28px;
  }
  .first-run {
    height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 10px 0;
    border-right: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-1) 70%, transparent);
    grid-row: span 1;
  }
  .logo {
    width: 44px;
    height: 36px;
    display: grid;
    place-items: center;
    color: var(--accent-text);
    margin-bottom: 6px;
  }
  .nav {
    position: relative;
    width: 46px;
    height: 46px;
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
