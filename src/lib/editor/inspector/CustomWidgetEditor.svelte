<script lang="ts">
  import { untrack } from 'svelte';
  import type { LayerKind } from '$lib/bindings/LayerKind';
  import Button from '$lib/ui/Button.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import { Maximize2, Minimize2, RotateCcw } from '@lucide/svelte';
  import { fieldSpecs, fieldsText, parseFieldsJson } from '../fields';
  import CodeEditor from '../ui/CodeEditor.svelte';
  import FieldsForm from './FieldsForm.svelte';

  type Custom = Extract<LayerKind, { type: 'custom' }>;
  type Tab = 'html' | 'css' | 'js' | 'fields';

  interface Props {
    kind: Custom;
    uid: string;
    /** Wider inspector for code. */
    wide: boolean;
    set: (fn: (k: Custom) => void, key: string) => void;
    ontogglewide: () => void;
  }

  let { kind, uid, wide, set, ontogglewide }: Props = $props();

  const TABS: Array<{ id: Tab; label: string; lang: 'html' | 'css' | 'javascript' | 'json' }> = [
    { id: 'html', label: 'HTML', lang: 'html' },
    { id: 'css', label: 'CSS', lang: 'css' },
    { id: 'js', label: 'JS', lang: 'javascript' },
    { id: 'fields', label: 'Fields', lang: 'json' }
  ];

  let tab = $state<Tab>('html');
  let fieldsDraft = $state(untrack(() => fieldsText(kind.fields)));
  let fieldsError = $state<string | null>(null);

  const fieldsJson = $derived(JSON.stringify(kind.fields ?? {}));
  const specs = $derived(fieldSpecs(kind.fields ?? {}));
  const hasValues = $derived(Object.keys(kind.values ?? {}).length > 0);

  // Undo or another edit changed the definitions: show them, unless the draft already says the same.
  $effect(() => {
    const current = fieldsJson;
    untrack(() => {
      const r = parseFieldsJson(fieldsDraft);
      if (!r.ok || JSON.stringify(r.fields) !== current) {
        fieldsDraft = fieldsText(JSON.parse(current) as Record<string, unknown>);
        fieldsError = null;
      }
    });
  });

  function onFields(text: string) {
    fieldsDraft = text;
    const r = parseFieldsJson(text);
    if (!r.ok) {
      fieldsError = r.error;
      return;
    }
    fieldsError = null;
    set((k) => {
      k.fields = r.fields;
    }, 'fields');
  }

  function onCode(id: Exclude<Tab, 'fields'>, text: string) {
    set((k) => {
      k[id] = text;
    }, id);
  }

  function key(e: KeyboardEvent) {
    const i = TABS.findIndex((t) => t.id === tab);
    let next = i;
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
    else return;
    e.preventDefault();
    tab = TABS[next]!.id;
    (e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  const active = $derived(TABS.find((t) => t.id === tab)!);
</script>

<div class="widget">
  <div class="bar">
    <div class="tabs" role="tablist" aria-label="Widget code" tabindex="-1" onkeydown={key}>
      {#each TABS as t (t.id)}
        <button
          type="button"
          role="tab"
          id="{uid}-tab-{t.id}"
          aria-selected={tab === t.id}
          aria-controls="{uid}-panel"
          tabindex={tab === t.id ? 0 : -1}
          class:bad={t.id === 'fields' && fieldsError}
          onclick={() => (tab = t.id)}>{t.label}</button
        >
      {/each}
    </div>
    <IconButton size="sm" label={wide ? 'Narrow code editor' : 'Widen code editor'} onclick={ontogglewide}>
      {#if wide}<Minimize2 />{:else}<Maximize2 />{/if}
    </IconButton>
  </div>
  <div class="panel" class:wide id="{uid}-panel" role="tabpanel" aria-labelledby="{uid}-tab-{tab}">
    {#key tab}
      {#if tab === 'fields'}
        <CodeEditor lang="json" label="Fields JSON" value={fieldsDraft} invalid={!!fieldsError} onchange={onFields} />
      {:else}
        {@const id = tab}
        <CodeEditor lang={active.lang} label="Widget {active.label}" value={kind[id] ?? ''} onchange={(v) => onCode(id, v)} />
      {/if}
    {/key}
  </div>
  {#if tab === 'fields'}
    {#if fieldsError}
      <p class="error" role="alert">{fieldsError}</p>
    {:else}
      <p class="hint">StreamElements field format. Use <code>{'{name}'}</code> in HTML, CSS or JS to insert a value.</p>
    {/if}
  {:else if tab === 'js'}
    <p class="hint">Listen for <code>onWidgetLoad</code> and <code>onEventReceived</code> like a StreamElements widget.</p>
  {/if}
</div>

<div class="settings">
  <div class="row head">
    <span class="eyebrow">Widget settings</span>
    <div class="grow"></div>
    {#if hasValues}
      <Button size="sm" variant="ghost" onclick={() => set((k) => { k.values = {}; }, 'reset')}><RotateCcw size={13} />Reset</Button>
    {/if}
  </div>
  {#if specs.length}
    <FieldsForm {specs} values={kind.values ?? {}} {uid} onset={(k, v) => set((x) => { x.values = { ...x.values, [k]: v }; }, `value:${k}`)} />
  {:else}
    <p class="hint">Add fields in the Fields tab to get settings here.</p>
  {/if}
</div>

<style>
  .widget {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tabs {
    flex: 1;
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius);
    background: var(--bg-2);
    border: 1px solid var(--border);
  }
  [role='tab'] {
    flex: 1;
    height: 24px;
    border: 0;
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 550;
    cursor: pointer;
  }
  [role='tab']:hover {
    color: var(--text);
  }
  [role='tab'][aria-selected='true'] {
    background: var(--bg-3);
    color: var(--text);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.15);
  }
  [role='tab'].bad {
    color: var(--danger);
  }
  .panel {
    height: 260px;
  }
  .panel.wide {
    height: min(52vh, 560px);
  }
  .hint {
    font-size: 11.5px;
    color: var(--text-faint);
  }
  .hint code {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
  }
  .error {
    font-size: 12px;
    color: var(--danger);
  }
  .settings {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .head {
    min-height: 24px;
  }
</style>
