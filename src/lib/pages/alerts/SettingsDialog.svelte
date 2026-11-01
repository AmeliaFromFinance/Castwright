<script lang="ts">
  import type { AlertSettings } from '$lib/bindings/AlertSettings';
  import Button from '$lib/ui/Button.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import Field from '$lib/ui/Field.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import { parseWordList } from './alerts';

  interface Props {
    open: boolean;
    settings: AlertSettings;
    onpatch: (patch: Partial<AlertSettings>) => void;
  }

  let { open = $bindable(), settings, onpatch }: Props = $props();

  function int(v: string, min: number, max: number): number | null {
    const n = Math.round(Number(v));
    return v.trim() === '' || !Number.isFinite(n) ? null : Math.min(max, Math.max(min, n));
  }

  function setNum(key: 'gap_ms' | 'min_bits' | 'min_raid_viewers' | 'max_queue', v: string, min: number, max: number) {
    const n = int(v, min, max);
    if (n === null) return;
    onpatch({ [key]: n });
  }
</script>

<Dialog bind:open title="Alert settings" description="Apply to every alert type." width={520}>
  <div class="form">
    <div class="grid">
      <Field label="Gap between alerts (s)" for="as-gap">
        <input
          id="as-gap"
          class="input"
          type="number"
          min="0"
          max="30"
          step="0.1"
          value={settings.gap_ms / 1000}
          oninput={(e) => {
            const n = Number(e.currentTarget.value);
            if (e.currentTarget.value.trim() !== '' && Number.isFinite(n)) {
              onpatch({ gap_ms: Math.round(Math.min(30, Math.max(0, n)) * 1000) });
            }
          }}
        />
      </Field>
      <Field label="Longest queue" for="as-max" hint="Older, lower priority alerts are dropped beyond this.">
        <input id="as-max" class="input" type="number" min="1" max="500" value={settings.max_queue} oninput={(e) => setNum('max_queue', e.currentTarget.value, 1, 500)} />
      </Field>
      <Field label="Minimum bits" for="as-bits" hint="0 shows every cheer.">
        <input id="as-bits" class="input" type="number" min="0" value={settings.min_bits} oninput={(e) => setNum('min_bits', e.currentTarget.value, 0, 1_000_000)} />
      </Field>
      <Field label="Minimum raid viewers" for="as-raid" hint="0 shows every raid.">
        <input
          id="as-raid"
          class="input"
          type="number"
          min="0"
          value={settings.min_raid_viewers}
          oninput={(e) => setNum('min_raid_viewers', e.currentTarget.value, 0, 1_000_000)}
        />
      </Field>
    </div>
    <Field label="Blocked words" for="as-words" hint="Comma separated. Viewer messages with these words are hidden and not read aloud.">
      <textarea
        id="as-words"
        class="input"
        rows="2"
        placeholder="e.g. spoiler, badword"
        value={settings.blocked_words.join(', ')}
        onchange={(e) => {
          onpatch({ blocked_words: parseWordList(e.currentTarget.value) });
        }}
      ></textarea>
    </Field>
    <div class="switches">
      <Switch
        label="Show one alert for a community gift, not one per sub"
        showLabel
        checked={settings.combine_gifts}
        onchange={(v) => {
          onpatch({ combine_gifts: v });
        }}
      />
      <Switch
        label="Replace links in viewer messages with [link]"
        showLabel
        checked={settings.hide_links}
        onchange={(v) => {
          onpatch({ hide_links: v });
        }}
      />
    </div>
  </div>
  {#snippet footer()}
    <Button variant="primary" onclick={() => (open = false)}>Done</Button>
  {/snippet}
</Dialog>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px 14px;
    align-items: start;
  }
  .switches {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
</style>
