<script lang="ts">
  import { api } from '$lib/api';
  import type { SessionSummary } from '$lib/bindings/SessionSummary';
  import TemplateField from '$lib/editors/TemplateField.svelte';
  import { DEFAULT_SOCIAL_TEMPLATE, PLACEHOLDERS, socialText } from '$lib/sessions/summary';
  import { app } from '$lib/state/app.svelte';
  import { attempt } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { RotateCcw } from '@lucide/svelte';

  const MAX = 2000;
  const tokens = PLACEHOLDERS.map(([token, label]) => ({ token, label }));

  let draft = $state(app.settings?.summary.social_template ?? DEFAULT_SOCIAL_TEMPLATE);
  let latest = $state<SessionSummary | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    api
      .listSessions(1)
      .then(([first]) => (first ? api.sessionSummary(first.session.id) : null))
      .then((s) => (latest = s))
      .catch(() => {});
  });

  const tooLong = $derived(draft.length > MAX);
  const preview = $derived(latest ? socialText(draft, latest, app.twitch?.broadcaster?.display_name ?? '') : '');

  async function save(text: string) {
    timer = undefined;
    const saved = await attempt(() => api.saveSummarySettings({ social_template: text }));
    if (saved && app.settings) app.settings.summary = saved;
  }

  function change(v: string) {
    draft = v;
    clearTimeout(timer);
    if (v.length > MAX) return;
    // Used right away by "Copy for socials"; saved once typing stops.
    if (app.settings && v.trim()) app.settings.summary = { social_template: v };
    timer = setTimeout(() => save(v), 600);
  }

  $effect(() => () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    if (draft.length <= MAX) void save(draft);
  });

  function reset() {
    clearTimeout(timer);
    draft = DEFAULT_SOCIAL_TEMPLATE;
    void save(DEFAULT_SOCIAL_TEMPLATE);
  }
</script>

<div class="summary">
  <TemplateField
    label="Copy for socials text"
    value={draft}
    multiline
    {tokens}
    onchange={change}
    error={tooLong ? `Keep it under ${MAX} characters.` : null}
    hint="Click a name to add it. Filters work too, like {'{{bits | number}}'}."
  />
  {#if preview}
    <div class="preview">
      <div class="label">Preview from your last stream</div>
      <p class="selectable">{preview}</p>
    </div>
  {/if}
  <div>
    <Button size="sm" variant="ghost" onclick={reset} disabled={draft === DEFAULT_SOCIAL_TEMPLATE}><RotateCcw size={14} />Use the default</Button>
  </div>
</div>

<style>
  .summary {
    max-width: 760px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .summary :global(textarea) {
    min-height: 92px;
  }
  .preview {
    padding: 10px 12px;
    border-radius: var(--radius);
    background: var(--bg-2);
    border: 1px solid var(--border);
  }
  .label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    margin-bottom: 4px;
  }
  .preview p {
    white-space: pre-wrap;
    font-size: 13px;
  }
</style>
