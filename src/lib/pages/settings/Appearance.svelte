<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { toasts } from '$lib/state/toast.svelte';
  import { BUILT_IN, generateTokens, parseSpec, checkTheme, type ThemeSpec } from '$lib/theme/themes';
  import { prefersDark } from '$lib/theme/apply';
  import type { WindowEffect } from '$lib/bindings/WindowEffect';
  import { copyText } from '$lib/util/os';
  import Button from '$lib/ui/Button.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import Segmented from '$lib/ui/Segmented.svelte';
  import Slider from '$lib/ui/Slider.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import Row from './Row.svelte';
  import ThemeEditor from './ThemeEditor.svelte';
  import { updateAppearance, updateWindowEffect } from './appearance.svelte';
  import { Plus, Pencil, Upload, Copy } from '@lucide/svelte';

  const appearance = $derived(app.settings!.appearance);
  const custom = $derived(appearance.custom_themes.map(parseSpec).filter((s): s is ThemeSpec => s !== null));

  const d = swatches(BUILT_IN[0]!);
  const l = swatches(BUILT_IN[1]!);

  let editing = $state<{ spec: ThemeSpec; isNew: boolean } | null>(null);
  let importOpen = $state(false);
  let importText = $state('');
  let importError = $state<string | null>(null);
  let confirmDelete = $state(false);
  let scale = $state(app.settings!.appearance.ui_scale);

  const os = $derived(app.info?.os ?? '');
  const effects = $derived.by(() => {
    const list: Array<{ value: WindowEffect; label: string }> = [{ value: 'solid', label: 'Solid' }];
    if (os === 'windows') list.push({ value: 'mica', label: 'Mica' }, { value: 'acrylic', label: 'Acrylic' });
    if (list.length > 1) list.unshift({ value: 'auto', label: 'Auto' });
    return list;
  });

  function swatches(spec: ThemeSpec) {
    const t = generateTokens(spec);
    return { bg: t['bg-0'], panel: t['bg-1'], text: t.text, muted: t['text-muted'], accent: t.accent, border: t.border };
  }

  function newId(name: string): string {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'theme';
    return `custom-${slug}-${Date.now().toString(36)}`;
  }

  function startFrom(spec: ThemeSpec) {
    const name = spec.high_contrast ? `${spec.name} (custom)` : `My ${spec.base} theme`;
    editing = { spec: { ...JSON.parse(JSON.stringify(spec)), id: newId(name), name, high_contrast: false }, isNew: true };
  }

  async function saveTheme(spec: ThemeSpec) {
    const list = appearance.custom_themes.filter((t) => parseSpec(t)?.id !== spec.id);
    const at = appearance.custom_themes.findIndex((t) => parseSpec(t)?.id === spec.id);
    const raw = spec as unknown as Record<string, unknown>;
    if (at >= 0) list.splice(at, 0, raw);
    else list.push(raw);
    if (await updateAppearance({ custom_themes: list, theme: spec.id })) {
      editing = null;
      toasts.success('Theme saved');
    }
  }

  async function deleteTheme() {
    if (!editing) return;
    const id = editing.spec.id;
    const list = appearance.custom_themes.filter((t) => parseSpec(t)?.id !== id);
    const theme = appearance.theme === id ? 'system' : appearance.theme;
    if (await updateAppearance({ custom_themes: list, theme })) {
      editing = null;
      confirmDelete = false;
    }
  }

  async function importTheme() {
    importError = null;
    let raw: unknown;
    try {
      raw = JSON.parse(importText);
    } catch {
      importError = "That isn't valid theme JSON.";
      return;
    }
    const spec = parseSpec(raw);
    if (!spec) {
      importError = 'Missing a name or id.';
      return;
    }
    spec.id = newId(spec.name);
    spec.high_contrast = false;
    importOpen = false;
    importText = '';
    editing = { spec, isNew: true };
  }

  async function readFile(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 64_000) {
      importError = 'That file is too big to be a theme.';
      return;
    }
    importText = await file.text();
  }

  function themeLabel(spec: ThemeSpec) {
    const fails = checkTheme(generateTokens(spec)).filter((c) => !c.pass).length;
    return fails ? `${fails} readability warning${fails === 1 ? '' : 's'}` : null;
  }
</script>

{#if editing}
  <div class="edit-wrap">
    <div class="eyebrow">{editing.isNew ? 'New theme' : 'Edit theme'}</div>
    <ThemeEditor
      spec={editing.spec}
      isNew={editing.isNew}
      onsave={saveTheme}
      oncancel={() => (editing = null)}
      ondelete={() => (confirmDelete = true)}
      onexport={(s) => copyText(JSON.stringify(s, null, 2), 'Theme JSON copied')}
    />
  </div>
{:else}
  <div class="themes" role="radiogroup" aria-label="Theme">
    <button
      type="button"
      class="theme"
      role="radio"
      aria-checked={appearance.theme === 'system'}
      onclick={() => updateAppearance({ theme: 'system' })}
    >
      <span class="swatch split">
        <span class="half" style="background:{l.bg}"><span class="bar" style="background:{l.accent}"></span></span>
        <span class="half" style="background:{d.bg}"><span class="bar" style="background:{d.accent}"></span></span>
      </span>
      <span class="tname">Match system</span>
      <span class="sub faint">Now {prefersDark() ? 'dark' : 'light'}</span>
    </button>
    {#each [...BUILT_IN, ...custom] as spec (spec.id)}
      {@const s = swatches(spec)}
      {@const isCustom = !BUILT_IN.some((b) => b.id === spec.id)}
      {@const warn = isCustom ? themeLabel(spec) : null}
      <div class="theme-cell">
        <button
          type="button"
          class="theme"
          role="radio"
          aria-checked={appearance.theme === spec.id}
          onclick={() => updateAppearance({ theme: spec.id })}
        >
          <span class="swatch" style="background:{s.bg}; border-color:{s.border}">
            <span class="mini" style="background:{s.panel}; border-color:{s.border}">
              <span class="line" style="background:{s.text}"></span>
              <span class="line short" style="background:{s.muted}"></span>
              <span class="pill" style="background:{s.accent}"></span>
            </span>
          </span>
          <span class="tname truncate">{spec.name}</span>
          <span class="sub" class:warn={!!warn}>{warn ?? (isCustom ? 'Custom' : spec.base === 'dark' ? 'Dark' : 'Light')}</span>
        </button>
        <button
          type="button"
          class="edit"
          aria-label={isCustom ? `Edit ${spec.name}` : `Customise a copy of ${spec.name}`}
          title={isCustom ? 'Edit' : 'Customise a copy'}
          onclick={() => (isCustom ? (editing = { spec: JSON.parse(JSON.stringify(spec)), isNew: false }) : startFrom(spec))}
        >
          {#if isCustom}<Pencil size={13} />{:else}<Copy size={13} />{/if}
        </button>
      </div>
    {/each}
  </div>
  <div class="row gap">
    <Button size="sm" onclick={() => startFrom(app.theme?.spec ?? BUILT_IN[0]!)}><Plus size={14} />New theme</Button>
    <Button size="sm" variant="ghost" onclick={() => ((importOpen = true), (importError = null))}><Upload size={14} />Import</Button>
  </div>

  <div class="rows">
    {#if effects.length > 1}
      <Row label="Window background" hint="See-through window effects. Auto picks the best one for your system.">
        <Segmented label="Window background" value={appearance.window_effect} options={effects} onchange={(v) => updateWindowEffect(v)} />
      </Row>
    {/if}
    <Row label="Interface size" hint="Makes all text and controls bigger or smaller.">
      <div class="scale">
        <Slider
          label="Interface size"
          min={90}
          max={175}
          step={5}
          bind:value={scale}
          format={(v) => `${v}%`}
          onchange={(v) => updateAppearance({ ui_scale: v })}
        />
      </div>
      {#if appearance.ui_scale !== 100}
        <Button size="sm" variant="ghost" onclick={() => ((scale = 100), updateAppearance({ ui_scale: 100 }))}>Reset</Button>
      {/if}
    </Row>
    <Row label="Reduce motion" hint="Turns off animations in the app. Overlays aren't affected.">
      <Switch label="Reduce motion" checked={appearance.reduce_motion} onchange={(v) => updateAppearance({ reduce_motion: v })} />
    </Row>
  </div>
{/if}

<Dialog bind:open={importOpen} title="Import a theme" description="Paste theme JSON, or pick a .json file someone shared." width={520}>
  <div class="stack import">
    <input type="file" accept=".json,application/json" onchange={readFile} aria-label="Theme file" />
    <textarea class="input mono" rows="8" bind:value={importText} placeholder={'{ "name": "…", "base": "dark", … }'} aria-label="Theme JSON"></textarea>
    {#if importError}<p class="err" role="alert">{importError}</p>{/if}
  </div>
  {#snippet footer()}
    <Button onclick={() => (importOpen = false)}>Cancel</Button>
    <Button variant="primary" disabled={!importText.trim()} onclick={importTheme}>Continue</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={confirmDelete} title="Delete this theme?" description="This can't be undone." width={400}>
  {#snippet footer()}
    <Button onclick={() => (confirmDelete = false)}>Keep</Button>
    <Button variant="danger" onclick={deleteTheme}>Delete</Button>
  {/snippet}
</Dialog>

<style>
  .themes {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 12px;
    max-width: 860px;
  }
  .theme-cell {
    position: relative;
  }
  .theme {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 8px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: var(--bg-1);
    text-align: left;
  }
  .theme:hover {
    border-color: var(--border-strong);
  }
  .theme[aria-checked='true'] {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .swatch {
    width: 100%;
    height: 70px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    margin-bottom: 6px;
    padding: 10px;
    display: flex;
  }
  .swatch.split {
    padding: 0;
    overflow: hidden;
  }
  .half {
    flex: 1;
    display: flex;
    align-items: flex-end;
    padding: 8px;
  }
  .bar {
    width: 28px;
    height: 8px;
    border-radius: 4px;
  }
  .mini {
    flex: 1;
    border-radius: 6px;
    border: 1px solid;
    padding: 7px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .line {
    height: 5px;
    width: 80%;
    border-radius: 3px;
  }
  .line.short {
    width: 50%;
  }
  .pill {
    margin-top: auto;
    width: 34px;
    height: 9px;
    border-radius: 4px;
  }
  .tname {
    font-weight: 600;
    font-size: 13px;
    max-width: 100%;
  }
  .sub {
    font-size: 11.5px;
    color: var(--text-faint);
  }
  .sub.warn {
    color: var(--warn);
  }
  .edit {
    position: absolute;
    top: 14px;
    right: 14px;
    width: 26px;
    height: 26px;
    border-radius: var(--radius);
    display: grid;
    place-items: center;
    background: var(--bg-1);
    color: var(--text-muted);
    border: 1px solid var(--border);
    opacity: 0;
    transition: opacity 0.12s;
  }
  .theme-cell:hover .edit,
  .edit:focus-visible {
    opacity: 1;
  }
  .edit:hover {
    color: var(--text);
  }
  .gap {
    gap: 8px;
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin-top: 12px;
  }
  .scale {
    width: 220px;
  }
  .edit-wrap {
    max-width: 1000px;
  }
  .edit-wrap .eyebrow {
    margin-bottom: 12px;
  }
  .import {
    gap: 10px;
  }
  .err {
    color: var(--danger);
    font-size: 12.5px;
  }
</style>
