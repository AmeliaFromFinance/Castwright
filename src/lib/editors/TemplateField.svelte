<script lang="ts">
  import { tick } from 'svelte';
  import { scanTemplate } from '$lib/logic/template';
  import { varHover } from '$lib/vars/hover';
  import VarChip from '$lib/vars/VarChip.svelte';
  import { insertToken, type Token } from './tokens';

  interface Props {
    label: string;
    value: string;
    tokens?: Token[];
    multiline?: boolean;
    placeholder?: string;
    error?: string | null;
    hint?: string;
    mono?: boolean;
    onchange: (v: string) => void;
  }

  let { label, value, tokens = [], multiline = false, placeholder, error = null, hint, mono = false, onchange }: Props = $props();

  const id = `tpl-${Math.random().toString(36).slice(2, 9)}`;
  let el: HTMLInputElement | HTMLTextAreaElement | undefined = $state();

  const hover = varHover();
  const cards = $derived.by(() => {
    if (!hover) return [];
    const seen = new Set<string>();
    return scanTemplate(value).flatMap((t) => {
      const c = hover.card(t.key);
      if (!c || seen.has(c.key)) return [];
      seen.add(c.key);
      return [c];
    });
  });

  async function insert(token: string) {
    const r = insertToken(value, el?.selectionStart ?? null, el?.selectionEnd ?? null, token);
    onchange(r.text);
    await tick();
    if (el) {
      el.value = r.text;
      el.focus();
      el.setSelectionRange(r.caret, r.caret);
    }
  }
</script>

<div class="tpl">
  <label for={id} class="label">{label}</label>
  {#if multiline}
    <textarea
      {id}
      bind:this={el}
      class="input"
      class:mono
      rows="3"
      {placeholder}
      spellcheck="false"
      aria-invalid={error ? 'true' : undefined}
      {value}
      oninput={(e) => onchange(e.currentTarget.value)}
    ></textarea>
  {:else}
    <input
      {id}
      bind:this={el}
      class="input"
      class:mono
      {placeholder}
      spellcheck="false"
      aria-invalid={error ? 'true' : undefined}
      {value}
      oninput={(e) => onchange(e.currentTarget.value)}
    />
  {/if}
  {#if hover && cards.length}
    <div class="vars" role="group" aria-label="Variables in {label}">
      {#each cards as c (c.key)}<VarChip card={c} {hover} />{/each}
    </div>
  {/if}
  {#if tokens.length}
    <div class="chips" role="group" aria-label="Insert into {label}">
      {#each tokens as t (t.token)}
        <button
          type="button"
          class="chip mono"
          title={t.label ? `${t.label}: insert {{${t.token}}}` : `Insert {{${t.token}}}`}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => insert(t.token)}>{t.token}</button
        >
      {/each}
    </div>
  {/if}
  {#if error}
    <p class="error" role="alert">{error}</p>
  {:else if hint}
    <p class="hint">{hint}</p>
  {/if}
</div>

<style>
  .tpl {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .label {
    font-size: 12px;
    font-weight: 550;
    color: var(--text-muted);
  }
  textarea {
    min-height: 56px;
  }
  .vars {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    height: 20px;
    padding: 0 7px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-2);
    color: var(--text-muted);
    font-size: 11px;
    cursor: pointer;
  }
  .chip:hover {
    color: var(--accent-text);
    border-color: var(--accent);
  }
  .hint {
    font-size: 12px;
    color: var(--text-faint);
  }
  .error {
    font-size: 12px;
    color: var(--danger);
  }
</style>
