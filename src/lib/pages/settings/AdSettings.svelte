<script lang="ts">
  import { api } from '$lib/api';
  import type { AdSettings } from '$lib/bindings/AdSettings';
  import { app } from '$lib/state/app.svelte';
  import { attempt } from '$lib/state/toast.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import Row from './Row.svelte';

  const current = $derived(app.settings?.ads ?? { warn: true, warn_minutes: 1 });

  async function save(next: AdSettings) {
    const saved = await attempt(() => api.saveAdSettings(next));
    if (saved && app.settings) app.settings.ads = saved;
  }
</script>

<Row label="Warn before ads" hint="A message with a Snooze button, once per ad.">
  <Switch label="Warn before ads" checked={current.warn} onchange={(on) => save({ ...current, warn: on })} />
</Row>
<Row label="Minutes before" hint="1 to 15 minutes.">
  <input
    class="input minutes"
    type="number"
    min="1"
    max="15"
    aria-label="Minutes before an ad"
    disabled={!current.warn}
    value={current.warn_minutes}
    onchange={(e) => {
      const n = Math.round(Number(e.currentTarget.value));
      if (Number.isFinite(n)) void save({ ...current, warn_minutes: Math.min(15, Math.max(1, n)) });
    }}
  />
</Row>
<p class="note faint">Castwright never switches scenes for ads. Subscribers and Turbo viewers skip ads and keep watching, so they would see a "be right back" screen for nothing.</p>

<style>
  .minutes {
    width: 80px;
  }
  .note {
    max-width: 760px;
    font-size: 12.5px;
    line-height: 1.5;
  }
</style>
