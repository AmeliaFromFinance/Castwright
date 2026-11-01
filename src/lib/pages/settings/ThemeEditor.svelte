<script lang="ts">
  import { checkTheme, cssVariables, generateTokens, TOKEN_NAMES, type ThemeSpec, type TokenName } from '$lib/theme/themes';
  import Button from '$lib/ui/Button.svelte';
  import Field from '$lib/ui/Field.svelte';
  import Slider from '$lib/ui/Slider.svelte';
  import Segmented from '$lib/ui/Segmented.svelte';
  import ColorInput from '$lib/ui/ColorInput.svelte';
  import { Check, X, RotateCcw, Download, Trash2 } from '@lucide/svelte';

  interface Props {
    spec: ThemeSpec;
    isNew: boolean;
    onsave: (spec: ThemeSpec) => void;
    oncancel: () => void;
    ondelete?: () => void;
    onexport?: (spec: ThemeSpec) => void;
  }
  let { spec, isNew, onsave, oncancel, ondelete, onexport }: Props = $props();

  // svelte-ignore state_referenced_locally
  let draft = $state<ThemeSpec>(JSON.parse(JSON.stringify(spec)) as ThemeSpec);
  let showTokens = $state(false);

  const tokens = $derived(generateTokens(draft));
  const base = $derived(generateTokens({ ...draft, overrides: {} }));
  const checks = $derived(checkTheme(tokens));
  const failing = $derived(checks.filter((c) => !c.pass).length);
  const vars = $derived(
    Object.entries(cssVariables({ spec: draft, tokens }))
      .map(([k, v]) => `${k}:${v}`)
      .join(';')
  );

  const hueSwatches = [262, 220, 190, 155, 95, 55, 25, 330];

  function setOverride(name: TokenName, value: string) {
    const o = { ...draft.overrides };
    if (value.toLowerCase() === base[name].toLowerCase()) delete o[name];
    else o[name] = value;
    draft.overrides = o;
  }
  function clearOverride(name: TokenName) {
    const o = { ...draft.overrides };
    delete o[name];
    draft.overrides = o;
  }
</script>

<div class="editor">
  <div class="controls">
    <Field label="Name" for="theme-name">
      <input id="theme-name" class="input" maxlength="60" bind:value={draft.name} />
    </Field>
    <Field label="Base">
      <Segmented
        label="Base"
        bind:value={draft.base}
        options={[
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'Light' }
        ]}
      />
    </Field>
    <Field label="Accent colour">
      <div class="hues">
        {#each hueSwatches as h (h)}
          <button
            type="button"
            class="hue"
            class:on={Math.round(draft.accent_hue) === h}
            style="background: oklch(0.6 0.17 {h})"
            aria-label="Hue {h}"
            onclick={() => (draft.accent_hue = h)}
          ></button>
        {/each}
      </div>
      <Slider label="Hue" min={0} max={360} step={1} bind:value={draft.accent_hue} format={(v) => `${Math.round(v)}°`} />
    </Field>
    <Field label="Accent strength">
      <Slider label="Accent strength" min={0} max={0.3} step={0.01} bind:value={draft.accent_chroma} format={(v) => `${Math.round((v / 0.3) * 100)}%`} />
    </Field>
    <Field label="Surface tint" hint="How much the accent colours the backgrounds">
      <Slider label="Surface tint" min={0} max={1} step={0.05} bind:value={draft.tint} format={(v) => `${Math.round(v * 100)}%`} />
    </Field>
    <Field label="Corner radius">
      <Slider label="Corner radius" min={0} max={16} step={1} bind:value={draft.radius} format={(v) => `${v}px`} />
    </Field>
    <div class="two">
      <Field label="Density">
        <Segmented
          label="Density"
          bind:value={draft.density}
          options={[
            { value: 'compact', label: 'Compact' },
            { value: 'default', label: 'Default' },
            { value: 'comfortable', label: 'Roomy' }
          ]}
        />
      </Field>
      <Field label="Font">
        <Segmented
          label="Font"
          bind:value={draft.font}
          options={[
            { value: 'inter', label: 'Inter' },
            { value: 'system', label: 'System' }
          ]}
        />
      </Field>
    </div>

    <button type="button" class="disclose" aria-expanded={showTokens} onclick={() => (showTokens = !showTokens)}>
      {showTokens ? 'Hide' : 'Fine-tune'} individual colours
      {#if Object.keys(draft.overrides).length}<span class="faint">({Object.keys(draft.overrides).length} changed)</span>{/if}
    </button>
    {#if showTokens}
      <div class="tokens">
        {#each TOKEN_NAMES as name (name)}
          <div class="token">
            <ColorInput label={name} value={tokens[name]} onchange={(v) => setOverride(name, v)} />
            <span class="mono tname">{name}</span>
            {#if draft.overrides[name]}
              <button type="button" class="reset" aria-label="Reset {name}" title="Reset" onclick={() => clearOverride(name)}>
                <RotateCcw size={13} />
              </button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <div class="side">
    <div class="preview" style={vars} data-base={draft.base} aria-label="Theme preview">
      <div class="p-window">
        <div class="p-rail"><span></span><span class="on"></span><span></span></div>
        <div class="p-main">
          <div class="p-panel">
            <div class="p-title">Recent events <span class="p-live">LIVE</span></div>
            <div class="p-item sel">mira_draws subscribed <span class="p-muted">Tier 1</span></div>
            <div class="p-item">quietfox cheered 500 <span class="p-muted">2m</span></div>
            <div class="p-item">Raid from bytebard <span class="p-faint">42 viewers</span></div>
            <div class="p-input">Type a message…</div>
            <div class="p-row">
              <span class="p-btn">Go live</span>
              <span class="p-btn2">Record</span>
              <span class="p-chip">Automation</span>
            </div>
            <div class="p-row">
              <span class="p-dot ok"></span><span class="p-dot warn"></span><span class="p-dot danger"></span>
              <span class="p-link">Overlay link</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="checks">
      <div class="row head">
        <b>Readability</b>
        <div class="grow"></div>
        {#if failing}
          <span class="bad">{failing} below the minimum</span>
        {:else}
          <span class="good">All checks pass</span>
        {/if}
      </div>
      <table>
        <tbody>
          {#each checks as c (c.label)}
            <tr class:fail={!c.pass}>
              <td>
                <span class="sw" style="background:{tokens[c.bg]};color:{tokens[c.fg]}">Aa</span>
              </td>
              <td class="lbl">{c.label}</td>
              <td class="num mono">{c.ratio.toFixed(1)}:1</td>
              <td class="st" aria-label={c.pass ? 'Pass' : `Needs ${c.min}:1`}>
                {#if c.pass}<Check size={14} />{:else}<X size={14} />{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="faint small">Text needs 4.5:1, borders and icons 3:1 (WCAG AA).</p>
    </div>
  </div>
</div>

<div class="footer row">
  {#if ondelete && !isNew}
    <Button variant="ghost" onclick={ondelete}><Trash2 size={14} />Delete</Button>
  {/if}
  {#if onexport}
    <Button variant="ghost" onclick={() => onexport($state.snapshot(draft) as ThemeSpec)}><Download size={14} />Export</Button>
  {/if}
  <div class="grow"></div>
  <Button onclick={oncancel}>Cancel</Button>
  <Button
    variant="primary"
    disabled={!draft.name.trim()}
    title={failing ? 'Some text may be hard to read' : undefined}
    onclick={() => onsave({ ...($state.snapshot(draft) as ThemeSpec), name: draft.name.trim() })}
  >
    {isNew ? 'Create theme' : 'Save theme'}
  </Button>
</div>

<style>
  .editor {
    display: grid;
    grid-template-columns: minmax(280px, 1fr) minmax(300px, 1.1fr);
    gap: 24px;
    align-items: start;
  }
  .controls {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .hues {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
  }
  .hue {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid transparent;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.2);
  }
  .hue.on {
    border-color: var(--text);
  }
  .disclose {
    align-self: flex-start;
    font-size: 12.5px;
    color: var(--accent-text);
  }
  .tokens {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 12px;
  }
  .token {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .tname {
    font-size: 11.5px;
    color: var(--text-muted);
  }
  .reset {
    color: var(--text-faint);
    display: grid;
    place-items: center;
  }
  .reset:hover {
    color: var(--text);
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 16px;
    position: sticky;
    top: 0;
  }

  /* Preview uses the draft's variables, so it's styled with them directly. */
  .preview {
    border-radius: var(--radius-lg);
    overflow: hidden;
    border: 1px solid var(--border);
    font-family: var(--font-ui);
    font-size: 12px;
    color: var(--text);
  }
  .p-window {
    display: flex;
    background: var(--bg-0);
    min-height: 200px;
  }
  .p-rail {
    width: 40px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding-top: 12px;
    border-right: 1px solid var(--border);
  }
  .p-rail span {
    width: 22px;
    height: 22px;
    border-radius: var(--radius);
    background: var(--bg-2);
  }
  .p-rail .on {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .p-main {
    flex: 1;
    padding: 12px;
  }
  .p-panel {
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .p-title {
    font-weight: 650;
    display: flex;
    justify-content: space-between;
  }
  .p-live {
    background: var(--live);
    color: var(--on-live);
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 999px;
  }
  .p-item {
    display: flex;
    justify-content: space-between;
    padding: 5px 8px;
    border-radius: var(--radius);
  }
  .p-item.sel {
    background: var(--bg-3);
  }
  .p-muted {
    color: var(--text-muted);
  }
  .p-faint {
    color: var(--text-faint);
  }
  .p-input {
    height: var(--row-h);
    display: flex;
    align-items: center;
    padding: 0 8px;
    background: var(--bg-2);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    color: var(--text-faint);
  }
  .p-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .p-btn,
  .p-btn2,
  .p-chip {
    padding: 4px 10px;
    border-radius: var(--radius);
    font-weight: 600;
  }
  .p-btn {
    background: var(--accent);
    color: var(--on-accent);
  }
  .p-btn2 {
    border: 1px solid var(--border-strong);
  }
  .p-chip {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .p-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .p-dot.ok {
    background: var(--ok);
  }
  .p-dot.warn {
    background: var(--warn);
  }
  .p-dot.danger {
    background: var(--danger);
  }
  .p-link {
    color: var(--accent-text);
    text-decoration: underline;
    margin-left: auto;
  }

  .checks {
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 12px;
    background: var(--bg-1);
  }
  .head {
    margin-bottom: 8px;
    font-size: 13px;
  }
  .good {
    color: var(--ok);
    font-size: 12px;
    font-weight: 600;
  }
  .bad {
    color: var(--danger);
    font-size: 12px;
    font-weight: 600;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  td {
    padding: 3px 4px;
  }
  .sw {
    display: inline-grid;
    place-items: center;
    width: 30px;
    height: 20px;
    border-radius: 4px;
    font-weight: 700;
    font-size: 11px;
    box-shadow: inset 0 0 0 1px rgb(127 127 127 / 0.3);
  }
  .lbl {
    width: 100%;
    color: var(--text-muted);
  }
  .num {
    text-align: right;
    white-space: nowrap;
  }
  .st {
    color: var(--ok);
  }
  tr.fail .st,
  tr.fail .num {
    color: var(--danger);
  }
  .small {
    font-size: 11.5px;
    margin-top: 8px;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .footer {
    gap: 8px;
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }
  @media (max-width: 980px) {
    .editor {
      grid-template-columns: 1fr;
    }
    .side {
      position: static;
    }
  }
</style>
