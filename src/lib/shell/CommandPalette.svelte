<script lang="ts">
  import { whatsNew } from '$lib/whatsnew/whatsnew.svelte';
  import { tick } from 'svelte';
  import { app, type Page } from '$lib/state/app.svelte';
  import { api } from '$lib/api';
  import { attempt, attemptOk, toasts } from '$lib/state/toast.svelte';
  import { ALERT_KINDS, KIND_LABELS } from '$lib/format';
  import { copyText } from '$lib/util/os';
  import { stepZoom } from '$lib/state/zoom';
  import { golive } from '$lib/state/golive.svelte';
  import { sessions } from '$lib/sessions/store.svelte';
  import { health } from '$lib/health/store.svelte';
  import { updateAppearance } from '$lib/pages/settings/theme-settings.svelte';
  import { fuzzyFilter } from './fuzzy';
  import { Search, CornerDownLeft } from '@lucide/svelte';

  interface Props {
    open: boolean;
    onshortcuts: () => void;
  }
  let { open = $bindable(), onshortcuts }: Props = $props();

  interface Item {
    group: string;
    label: string;
    hint?: string;
    run: () => void | Promise<unknown>;
  }

  let query = $state('');
  let active = $state(0);
  let input: HTMLInputElement | undefined = $state();
  let list: HTMLElement | undefined = $state();

  function go(page: Page) {
    app.editingOverlay = page === 'overlays' ? null : app.editingOverlay;
    app.page = page;
  }

  async function settingsSection(id: string) {
    app.page = 'settings';
    await tick();
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 50);
  }

  async function openAlert(kind: (typeof ALERT_KINDS)[number]) {
    app.page = 'alerts';
    const { alertsEditor } = await import('$lib/pages/alerts/store.svelte');
    alertsEditor.kind = kind;
  }

  async function openAction(id: string) {
    app.page = 'automation';
    const mod = await import('$lib/pages/automation/store.svelte');
    const ed = (mod as { actionsEditor?: { selectedId: string | null } }).actionsEditor;
    if (ed) ed.selectedId = id;
  }

  function zoom(dir: 1 | -1 | 0) {
    const cur = app.settings?.appearance.ui_scale ?? 100;
    const next = dir === 0 ? 100 : stepZoom(cur, dir);
    updateAppearance({ ui_scale: next });
    toasts.show(`Zoom ${next}%`, 'info', 1500, 'zoom');
  }

  const items = $derived.by<Item[]>(() => {
    const out: Item[] = [
      { group: 'Go to', label: 'Overlays', hint: 'Ctrl 1', run: () => go('overlays') },
      { group: 'Go to', label: 'Alerts', hint: 'Ctrl 2', run: () => go('alerts') },
      { group: 'Go to', label: 'Automation', hint: 'Ctrl 3', run: () => go('automation') },
      { group: 'Go to', label: 'Activity', hint: 'Ctrl 4', run: () => go('activity') },
      { group: 'Go to', label: 'Interact', hint: 'Ctrl 5', run: () => go('interact') },
      { group: 'Go to', label: 'Settings', hint: 'Ctrl ,', run: () => go('settings') }
    ];
    for (const [id, label] of [
      ['obs', 'OBS connection'],
      ['twitch', 'Twitch accounts'],
      ['server', 'Overlay server'],
      ['appearance', 'Appearance and themes'],
      ['golive', 'Go-live check'],
      ['hotkeys', 'Global hotkeys'],
      ['summary', 'Stream summary text'],
      ['backups', 'Backups']
    ] as const) {
      out.push({ group: 'Settings', label, run: () => settingsSection(id) });
    }
    for (const o of app.project?.overlays ?? []) {
      out.push({
        group: 'Overlays',
        label: `Edit ${o.name}`,
        run: () => {
          app.page = 'overlays';
          app.editingOverlay = o.id;
        }
      });
      out.push({
        group: 'Overlays',
        label: `Copy OBS link: ${o.name}`,
        run: async () => {
          const url = await attempt(() => api.overlayUrl(o.id));
          if (url) await copyText(url, 'Overlay link copied');
        }
      });
    }
    for (const k of ALERT_KINDS) {
      out.push({ group: 'Alerts', label: `Edit ${KIND_LABELS[k]} alert`, run: () => openAlert(k) });
      out.push({ group: 'Alerts', label: `Test ${KIND_LABELS[k]} alert`, run: () => attemptOk(() => api.testEvent(k), 'Test alert queued') });
    }
    out.push(
      {
        group: 'Alerts',
        label: app.queue.paused ? 'Resume alerts' : 'Pause alerts',
        run: () => attemptOk(() => api.alertPause(!app.queue.paused))
      },
      { group: 'Alerts', label: 'Skip the current alert', run: () => attemptOk(() => api.alertSkip()) },
      { group: 'Alerts', label: 'Replay the last alert', run: () => attemptOk(() => api.alertReplayLast()) },
      {
        group: 'Alerts',
        label: app.queue.muted ? 'Unmute alert sound' : 'Mute alert sound',
        run: () => attemptOk(() => api.alertMute(!app.queue.muted), app.queue.muted ? 'Alert sound on' : 'Alert sound muted')
      },
      { group: 'Alerts', label: 'Clear waiting alerts', run: () => attemptOk(() => api.alertClear(), 'Queue cleared') }
    );
    for (const a of app.project?.actions ?? []) {
      out.push({ group: 'Automation', label: `Edit ${a.name}`, run: () => openAction(a.id) });
      out.push({ group: 'Automation', label: `Run ${a.name}`, run: () => attemptOk(() => api.runAction(a.id), `Ran ${a.name}`) });
    }
    out.push(
      { group: 'View', label: 'Zoom in', hint: 'Ctrl +', run: () => zoom(1) },
      { group: 'View', label: 'Zoom out', hint: 'Ctrl -', run: () => zoom(-1) },
      { group: 'View', label: 'Reset zoom', hint: 'Ctrl 0', run: () => zoom(0) },
      {
        group: 'View',
        label: app.theme?.spec.base === 'light' ? 'Switch to dark theme' : 'Switch to light theme',
        run: () => updateAppearance({ theme: app.theme?.spec.base === 'light' ? 'dark' : 'light' })
      },
      { group: 'Help', label: 'Keyboard shortcuts', hint: 'Ctrl /', run: onshortcuts },
      { group: 'Help', label: "What's new", run: () => whatsNew.show(app.info?.version ?? '') },
      { group: 'Help', label: 'Health', run: () => health.show() },
      { group: 'Help', label: 'Save bug report…', run: () => health.showReport() },
      { group: 'Stream', label: 'Go-live check', run: () => golive.show() },
      { group: 'Stream', label: 'Last stream summary', run: () => sessions.showLatest() },
      {
        group: 'Stream',
        label: 'Past streams',
        run: () => {
          go('activity');
          app.activityTab = 'sessions';
        }
      },
      { group: 'Stream', label: 'Reset session counters', run: () => attemptOk(() => api.resetSession(), 'Counters reset') },
      {
        group: 'Stream',
        label: 'Back up the project now',
        run: async () => {
          const made = await attempt(() => api.createBackup());
          if (made !== undefined) toasts.success(made ? 'Backup saved' : 'Nothing changed since the last backup');
        }
      }
    );
    return out;
  });

  const shown = $derived(fuzzyFilter(items, query, (i) => `${i.label} ${i.group}`, 60));

  $effect(() => {
    void query;
    active = 0;
  });

  $effect(() => {
    if (open) {
      query = '';
      tick().then(() => input?.focus());
    }
  });

  async function choose(item: Item | undefined) {
    if (!item) return;
    open = false;
    await item.run();
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') active = Math.min(shown.length - 1, active + 1);
    else if (e.key === 'ArrowUp') active = Math.max(0, active - 1);
    else if (e.key === 'Enter') choose(shown[active]);
    else if (e.key === 'Escape') open = false;
    else return;
    e.preventDefault();
    tick().then(() => list?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }));
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={() => (open = false)}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="palette" role="dialog" aria-modal="true" aria-label="Command palette" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <label class="search">
        <Search size={16} />
        <input
          bind:this={input}
          bind:value={query}
          onkeydown={key}
          placeholder="Search pages, overlays, alerts, actions…"
          aria-label="Search commands"
          role="combobox"
          aria-expanded="true"
          aria-controls="cw-palette-list"
          aria-activedescendant={shown[active] ? `cw-cmd-${active}` : undefined}
          spellcheck="false"
          autocomplete="off"
        />
        <kbd>Esc</kbd>
      </label>
      <ul id="cw-palette-list" role="listbox" bind:this={list} aria-label="Commands">
        {#each shown as item, i (item.group + item.label)}
          {#if i === 0 || shown[i - 1]!.group !== item.group}
            <li class="group" role="presentation">{item.group}</li>
          {/if}
          <li
            id="cw-cmd-{i}"
            role="option"
            aria-selected={i === active}
            class:active={i === active}
            onmousemove={() => (active = i)}
            onclick={() => choose(item)}
          >
            <span class="truncate">{item.label}</span>
            {#if item.hint}<kbd>{item.hint}</kbd>{:else if i === active}<CornerDownLeft size={13} />{/if}
          </li>
        {:else}
          <li class="none" role="presentation">Nothing matches.</li>
        {/each}
      </ul>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgb(0 0 0 / 0.35);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 12vh;
  }
  .palette {
    width: min(620px, 92vw);
    max-height: 64vh;
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: var(--bg-1);
    box-shadow: var(--shadow-pop);
    overflow: hidden;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 14px;
    border-bottom: 1px solid var(--border);
    color: var(--text-faint);
  }
  .search input {
    flex: 1;
    height: 48px;
    border: 0;
    background: none;
    color: var(--text);
    font-size: 15px;
    outline: none;
  }
  ul {
    list-style: none;
    overflow-y: auto;
    padding: 6px;
  }
  li[role='option'] {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--radius);
    font-size: 13.5px;
    cursor: pointer;
  }
  li[role='option'] span {
    flex: 1;
  }
  li.active {
    background: var(--bg-3);
  }
  .group {
    padding: 8px 10px 4px;
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .none {
    padding: 16px 10px;
    color: var(--text-muted);
    font-size: 13px;
  }
  kbd {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 4px;
    border: 1px solid var(--border);
    color: var(--text-muted);
    background: var(--bg-2);
  }
</style>
