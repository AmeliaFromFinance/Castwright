<script lang="ts">
  import { api } from '$lib/api';
  import type { SessionSummary } from '$lib/bindings/SessionSummary';
  import { app } from '$lib/state/app.svelte';
  import { attemptOk, toasts } from '$lib/state/toast.svelte';
  import { copyText } from '$lib/util/os';
  import Button from '$lib/ui/Button.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import { Copy, Download, Trash2 } from '@lucide/svelte';
  import SummaryCard from './SummaryCard.svelte';
  import { saveExport, type ExportType } from './export';
  import { sessions } from './store.svelte';
  import { DEFAULT_SOCIAL_TEMPLATE, exportName, socialText, toCsv, toJson } from './summary';

  let summary = $state<SessionSummary | null>(null);
  let failed = $state(false);
  let confirming = $state(false);
  let busy = $state<ExportType | null>(null);

  const open = $derived(sessions.openId !== null);
  const dark = $derived(app.theme?.spec.base !== 'light');
  const channel = $derived(app.twitch?.broadcaster?.display_name ?? '');

  $effect(() => {
    const id = sessions.openId;
    void sessions.version;
    confirming = false;
    if (id === null) {
      summary = null;
      return;
    }
    let stale = false;
    failed = false;
    api
      .sessionSummary(id)
      .then((s) => {
        if (!stale) summary = s;
      })
      .catch((e) => {
        if (stale) return;
        failed = true;
        toasts.error(e);
      });
    return () => (stale = true);
  });

  function copy() {
    if (!summary) return;
    const template = app.settings?.summary.social_template || DEFAULT_SOCIAL_TEMPLATE;
    void copyText(socialText(template, summary, channel), 'Summary copied');
  }

  async function exportAs(type: ExportType) {
    if (!summary) return;
    busy = type;
    try {
      const data =
        type === 'csv'
          ? toCsv(summary)
          : type === 'json'
            ? toJson(summary)
            : await (await import('./image')).renderPng({ summary, channel, dark });
      if (await saveExport(exportName(summary), type, data)) toasts.success(type === 'png' ? 'Image saved' : `${type.toUpperCase()} saved`);
    } catch (e) {
      toasts.error(e);
    } finally {
      busy = null;
    }
  }

  async function remove() {
    if (!summary) return;
    const id = summary.session.id;
    if (await attemptOk(() => api.deleteSession(id), 'Stream deleted')) {
      sessions.close();
      sessions.changed();
    }
  }
</script>

<Dialog open={open} title="Stream summary" width={1080} onclose={() => sessions.close()}>
  {#if summary}
    <SummaryCard {summary} {dark} />
  {:else if failed}
    <p class="muted">This stream couldn't be loaded.</p>
  {:else}
    <p class="muted" aria-busy="true">Loading…</p>
  {/if}
  {#snippet footer()}
    {#if confirming}
      <span class="ask">Delete this stream and its counts? This can't be undone.</span>
      <div class="grow"></div>
      <Button size="sm" variant="ghost" onclick={() => (confirming = false)}>Cancel</Button>
      <Button size="sm" variant="danger" onclick={remove}>Delete</Button>
    {:else}
      <Button
        size="sm"
        variant="ghost"
        onclick={() => (confirming = true)}
        disabled={!summary || summary.session.ended_at === null}
        title={summary?.session.ended_at === null ? 'You can delete it after the stream ends' : undefined}><Trash2 size={14} />Delete</Button
      >
      <div class="grow"></div>
      <div class="exports" role="group" aria-label="Export">
        <span class="faint">Export</span>
        <Button size="sm" onclick={() => exportAs('png')} disabled={!summary} busy={busy === 'png'}><Download size={14} />Image</Button>
        <Button size="sm" onclick={() => exportAs('csv')} disabled={!summary} busy={busy === 'csv'}>CSV</Button>
        <Button size="sm" onclick={() => exportAs('json')} disabled={!summary} busy={busy === 'json'}>JSON</Button>
      </div>
      <Button size="sm" variant="primary" onclick={copy} disabled={!summary}><Copy size={14} />Copy for socials</Button>
    {/if}
  {/snippet}
</Dialog>

<style>
  .exports {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-right: 10px;
    margin-right: 2px;
    border-right: 1px solid var(--border);
    font-size: 12px;
  }
  .exports span {
    margin-right: 2px;
  }
  .ask {
    font-size: 13px;
  }
</style>
