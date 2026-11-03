<script lang="ts">
  import type { SoundButton } from '$lib/bindings/SoundButton';
  import type { SoundOutput } from '$lib/bindings/SoundOutput';
  import RewardPicker from '$lib/pages/automation/RewardPicker.svelte';
  import KeyRecorder from '$lib/pages/settings/KeyRecorder.svelte';
  import { findConflict, formatCombo, isAppShortcut, soundHotkey } from '$lib/pages/settings/hotkeys';
  import { newButton, OUTPUT_LABELS, pageLabel, pages } from '$lib/soundboard/board';
  import { currentBoard, saveSoundHotkey } from '$lib/soundboard/store.svelte';
  import { app } from '$lib/state/app.svelte';
  import { toasts } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import ColorInput from '$lib/ui/ColorInput.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import Segmented from '$lib/ui/Segmented.svelte';
  import Slider from '$lib/ui/Slider.svelte';
  import AssetPicker from '$lib/widgets/AssetPicker.svelte';
  import { Copy } from '@lucide/svelte';

  interface Props {
    open: boolean;
    sound: SoundButton;
    /** Not on the board yet. */
    isNew: boolean;
    onsave: (b: SoundButton) => void;
    ondelete: (b: SoundButton) => void;
  }

  let { open = $bindable(), sound, isNew, onsave, ondelete }: Props = $props();

  const mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);
  let draft = $state<SoundButton>(newButton());
  let aliases = $state('');
  $effect(() => {
    if (open) {
      draft = structuredClone($state.snapshot(sound));
      aliases = sound.aliases.join(', ');
    }
  });

  const board = $derived(currentBoard());
  const signedIn = $derived(!!app.twitch?.broadcaster);
  const hotkey = $derived(soundHotkey(app.settings?.hotkeys.bindings ?? [], draft.id));
  const base = $derived(app.server ? `${app.server.base_url}/api/sounds/${draft.id}` : '');
  const token = $derived(app.server ? `?token=${encodeURIComponent(app.server.token)}` : '');
  const valid = $derived(draft.label.trim().length > 0);

  function recordKey(keys: string): string | null {
    const bindings = app.settings?.hotkeys.bindings ?? [];
    const mine = bindings.findIndex((b) => b.action.type === 'play_sound_button' && b.action.sound_id === draft.id);
    const other = findConflict(bindings, keys, mine);
    if (other >= 0) return `${formatCombo(keys, mac)} is already used by another hotkey.`;
    if (isAppShortcut(keys)) return `Castwright uses ${formatCombo(keys, mac)} inside the app. Pick another.`;
    void saveSoundHotkey(draft.id, keys);
    return null;
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toasts.success('Copied');
    } catch {
      toasts.show('Copy failed. Select the address and copy it by hand.', 'error');
    }
  }

  function save() {
    if (!valid) return;
    onsave({
      ...draft,
      label: draft.label.trim(),
      aliases: aliases
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean)
    });
  }
</script>

<Dialog bind:open title={isNew ? 'Add sound' : 'Edit sound'} width={560}>
  <form
    class="form"
    id="sound-form"
    onsubmit={(e) => {
      e.preventDefault();
      save();
    }}
  >
    <div class="row3">
      <div class="f">
        <label for="snd-label">Name</label>
        <input id="snd-label" class="input" maxlength="60" bind:value={draft.label} aria-invalid={!valid} />
      </div>
      <div class="f emoji">
        <label for="snd-emoji">Emoji</label>
        <input id="snd-emoji" class="input" maxlength="8" placeholder="🔊" bind:value={draft.emoji} />
      </div>
      <div class="f">
        <label for="snd-color">Colour</label>
        <ColorInput id="snd-color" label="Button colour" bind:value={draft.color} />
      </div>
    </div>

    <div class="f">
      <label for="snd-src">Sound file</label>
      <AssetPicker id="snd-src" kind="audio" label="Sound file" bind:value={draft.src} />
    </div>

    <div class="row2">
      <div class="f">
        <label for="snd-vol">Volume</label>
        <Slider id="snd-vol" label="Volume" min={0} max={100} bind:value={draft.volume} format={(n) => `${n}%`} />
      </div>
      <div class="f">
        <label for="snd-cd">Cooldown (s)</label>
        <input
          id="snd-cd"
          class="input"
          type="number"
          min="0"
          max="86400"
          value={draft.cooldown_s}
          oninput={(e) => {
            const n = Math.round(Number(e.currentTarget.value));
            if (Number.isFinite(n)) draft.cooldown_s = Math.min(86_400, Math.max(0, n));
          }}
        />
      </div>
    </div>

    <div class="f">
      <span class="label">Plays</span>
      <Segmented
        label="Where it plays"
        value={draft.output}
        options={(['stream', 'local', 'both'] as SoundOutput[]).map((value) => ({ value, label: OUTPUT_LABELS[value] }))}
        onchange={(v) => (draft.output = v)}
      />
      <p class="hint">
        {#if draft.output === 'local'}Only you hear it, here in Castwright. Viewers don't.{:else if draft.output === 'both'}Viewers hear it through OBS, and you hear it here too.{:else}Viewers hear it through OBS. It plays in overlays that have an Alerts layer.{/if}
      </p>
    </div>

    <div class="row2">
      <div class="f">
        <label for="snd-page">Page</label>
        <select id="snd-page" class="input" bind:value={draft.group}>
          {#each pages(board) as g (g)}<option value={g}>{pageLabel(g)}</option>{/each}
        </select>
      </div>
      <div class="f">
        <label for="snd-alias">Other names</label>
        <input id="snd-alias" class="input" placeholder="Separated by commas" bind:value={aliases} />
      </div>
    </div>
    <p class="hint top">Viewers can use the name or other names with <code>!{board.command.name}</code> and sound requests.</p>

    <div class="f">
      <label for="snd-reward">Channel point reward</label>
      {#if signedIn}
        <RewardPicker
          id="snd-reward"
          rewardId={draft.reward_id}
          rewardTitle={draft.reward_title}
          onlyMine
          onchange={(id, title) => {
            draft.reward_id = id;
            draft.reward_title = title;
          }}
        />
        <p class="hint">Redeeming it plays the sound and completes the redemption. On cooldown or muted, the points go back.</p>
      {:else}
        <p class="hint">Sign in to Twitch to link a reward.</p>
      {/if}
    </div>

    <div class="f">
      <span class="label">Hotkey</span>
      {#if isNew}
        <p class="hint">Save the sound first, then set a hotkey.</p>
      {:else}
        <KeyRecorder value={hotkey} label={draft.label} {mac} onrecord={recordKey} />
        <p class="hint">Works while another app has focus. Also in Settings → Hotkeys.</p>
      {/if}
    </div>

    {#if !isNew && base}
      <div class="f">
        <span class="label">Stream Deck</span>
        {#each [{ what: 'Play', url: `${base}/play${token}` }, { what: 'Stop', url: `${base}/stop${token}` }] as link (link.what)}
          <div class="url">
            <span class="what">{link.what}</span>
            <code class="mono truncate">POST {link.url}</code>
            <IconButton size="sm" label="Copy the {link.what.toLowerCase()} address" onclick={() => copy(link.url)}><Copy /></IconButton>
          </div>
        {/each}
      </div>
    {/if}
  </form>

  {#snippet footer()}
    {#if !isNew}
      <Button variant="danger" onclick={() => ondelete(draft)}>Delete</Button>
    {/if}
    <div class="grow"></div>
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form="sound-form" disabled={!valid}>{isNew ? 'Add sound' : 'Save'}</Button>
  {/snippet}
</Dialog>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .f {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .row2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .row3 {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 80px minmax(0, 0.9fr);
    gap: 12px;
  }
  label,
  .label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
  }
  .emoji input {
    text-align: center;
    font-size: 16px;
  }
  .hint {
    font-size: 12px;
    color: var(--text-faint);
  }
  .hint.top {
    margin-top: -8px;
  }
  .url {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }
  .what {
    width: 34px;
    flex: none;
    color: var(--text-muted);
  }
  code {
    flex: 1;
    min-width: 0;
    padding: 4px 8px;
    border-radius: var(--radius);
    background: var(--bg-2);
  }
</style>
