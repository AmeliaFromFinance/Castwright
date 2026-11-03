<script lang="ts">
  import type { ChatRules } from '$lib/bindings/ChatRules';
  import type { HighlightColors } from '$lib/bindings/HighlightColors';
  import { checkPattern, KNOWN_BOTS, resolveRules, splitList } from '$lib/overlay/chat-filters';
  import ColorInput from '$lib/ui/ColorInput.svelte';
  import Switch from '$lib/ui/Switch.svelte';

  interface Props {
    rules: ChatRules;
    onchange: (next: ChatRules) => void;
    uid: string;
    /** Narrow layout for the editor inspector. */
    compact?: boolean;
  }

  let { rules, onchange, uid, compact = false }: Props = $props();
  const r = $derived(resolveRules(rules));

  type ListKey = 'bots' | 'hide_users' | 'hide_words' | 'highlight_keywords' | 'highlight_users';
  let errors = $state<Partial<Record<ListKey, string>>>({});

  function set<K extends keyof ChatRules>(key: K, value: ChatRules[K]) {
    onchange({ ...r, [key]: value });
  }

  function setList(key: ListKey, text: string) {
    const names = key === 'bots' || key === 'hide_users' || key === 'highlight_users';
    const list = splitList(text, names);
    if (!names) {
      const bad = list.map((e) => [e, checkPattern(e)] as const).find(([, err]) => err);
      if (bad) {
        errors = { ...errors, [key]: `“${bad[0]}”: ${bad[1]}` };
        return;
      }
    }
    errors = { ...errors, [key]: undefined };
    set(key, list);
  }

  function setColor(key: keyof HighlightColors, v: string) {
    set('colors', { ...r.colors, [key]: v });
  }

  const HIGHLIGHTS: Array<{ key: 'highlight_first' | 'highlight_mentions' | 'highlight_mods' | 'highlight_vips' | 'highlight_redeemed'; label: string; color: keyof HighlightColors }> = [
    { key: 'highlight_first', label: 'First-time chatters', color: 'first' },
    { key: 'highlight_mentions', label: 'Mentions of your name', color: 'mention' },
    { key: 'highlight_mods', label: 'Mods', color: 'user' },
    { key: 'highlight_vips', label: 'VIPs', color: 'user' },
    { key: 'highlight_redeemed', label: '“Highlight my message” redemptions', color: 'redeemed' }
  ];
</script>

{#snippet list(key: ListKey, label: string, hint: string, placeholder: string)}
  <div class="field">
    <label class="label" for="{uid}-{key}">{label}</label>
    <textarea
      id="{uid}-{key}"
      class="input mono"
      rows={compact ? 2 : 3}
      spellcheck="false"
      {placeholder}
      aria-invalid={!!errors[key]}
      value={r[key].join('\n')}
      onchange={(e) => setList(key, e.currentTarget.value)}
    ></textarea>
    {#if errors[key]}<p class="error" role="alert">{errors[key]}</p>{:else}<p class="hint">{hint}</p>{/if}
  </div>
{/snippet}

<div class="rules" class:compact>
  <section aria-labelledby="{uid}-hide-h">
    <h4 id="{uid}-hide-h">Hide</h4>
    <Switch label="Bots" showLabel checked={r.hide_bots} onchange={(v) => set('hide_bots', v)} />
    {#if r.hide_bots}
      {@render list('bots', 'Bot accounts', 'Your own bot account is always included.', KNOWN_BOTS.join('\n'))}
    {/if}
    <Switch label="Messages starting with !" showLabel checked={r.hide_commands} onchange={(v) => set('hide_commands', v)} />
    {@render list('hide_users', 'Users', 'One name per line.', 'username')}
    {@render list('hide_words', 'Words', 'One per line. Whole words, any case. Use /pattern/i for a regular expression.', 'spoiler\n/b[a4]d ?word/i')}
  </section>

  <section aria-labelledby="{uid}-hl-h">
    <h4 id="{uid}-hl-h">Highlight</h4>
    {#each HIGHLIGHTS as h (h.key)}
      <Switch label={h.label} showLabel checked={r[h.key]} onchange={(v) => set(h.key, v)} />
    {/each}
    {@render list('highlight_keywords', 'Keywords', 'One per line, like the words above.', 'giveaway')}
    {@render list('highlight_users', 'Users', 'One name per line.', 'username')}
    <div class="colors" role="group" aria-label="Highlight colours">
      <span class="label">Colours</span>
      <div class="swatches">
        <span class="sw"><ColorInput label="First-time chatter colour" value={r.colors.first} onchange={(v) => setColor('first', v)} />First</span>
        <span class="sw"><ColorInput label="Mention colour" value={r.colors.mention} onchange={(v) => setColor('mention', v)} />Mention</span>
        <span class="sw"><ColorInput label="Keyword colour" value={r.colors.keyword} onchange={(v) => setColor('keyword', v)} />Keyword</span>
        <span class="sw"><ColorInput label="User colour" value={r.colors.user} onchange={(v) => setColor('user', v)} />User</span>
        <span class="sw"><ColorInput label="Redeemed colour" value={r.colors.redeemed} onchange={(v) => setColor('redeemed', v)} />Points</span>
      </div>
    </div>
  </section>
</div>

<style>
  .rules {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 28px;
    max-width: 860px;
  }
  .rules.compact {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  h4 {
    font-size: 12px;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .label {
    font-size: 12.5px;
    font-weight: 550;
  }
  textarea {
    resize: vertical;
    min-height: 44px;
    font-size: 12px;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .hint {
    font-size: 11.5px;
    color: var(--text-faint);
    line-height: 1.4;
  }
  .error {
    font-size: 11.5px;
    color: var(--danger);
  }
  .colors {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
  }
  .sw {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .sw :global(.color input:not([type='color'])) {
    display: none;
  }
</style>
