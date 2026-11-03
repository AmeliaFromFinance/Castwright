<script lang="ts">
  import { api } from '$lib/api';
  import Popover from '$lib/editor/ui/Popover.svelte';
  import { adLabel, adPhase, countdown } from '$lib/overlay/ads';
  import { clock, useClock } from '$lib/overlay/clock.svelte';
  import { app } from '$lib/state/app.svelte';
  import { attemptOk } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { AlarmClockOff, Tv } from '@lucide/svelte';

  const LENGTHS = [30, 60, 90, 120, 150, 180];

  $effect(() => useClock());

  const s = $derived(app.ads);
  const now = $derived(clock.now);
  const phase = $derived(adPhase(s, now));
  const label = $derived(adLabel(s, now) ?? 'No ad scheduled');
  const scopes = $derived(app.twitch?.broadcaster?.scopes ?? []);
  // An empty list means Twitch didn't say, so don't block.
  const canSnooze = $derived(!scopes.length || scopes.includes('channel:manage:ads'));
  const at = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const lengthText = (secs: number) => (secs < 60 ? `${secs} s` : secs % 60 ? countdown(secs) : `${secs / 60} min`);

  let length = $state(60);
  let busy = $state<'snooze' | 'run' | null>(null);

  async function snooze() {
    busy = 'snooze';
    await app.snoozeAd();
    busy = null;
  }

  async function run() {
    busy = 'run';
    await attemptOk(() => api.runAd(length), `Starting a ${lengthText(length)} ad`);
    busy = null;
  }
</script>

<Popover role="dialog" label="Ad break" align="end" above width={290}>
  {#snippet trigger(p)}
    <button type="button" class="item link ads" class:running={phase?.phase === 'running'} class:soon={phase?.phase === 'soon' && phase.seconds <= 60} title="Ad break" {...p}>
      <Tv size={12} />{label}
    </button>
  {/snippet}
  {#snippet children()}
    <div class="pop" data-testid="ad-popover">
      <div class="head">
        <div class="eyebrow">{phase?.phase === 'running' ? 'Ad running' : 'Next ad'}</div>
        {#if phase?.phase === 'running'}
          <div class="big mono">{countdown(phase.seconds)} left</div>
          <div class="faint small">{lengthText(phase.length_s)} ad</div>
        {:else if phase}
          <div class="big mono">in {countdown(phase.seconds)}</div>
          <div class="faint small">At {at(s.next_ad_at)}, {lengthText(s.length_s)} long</div>
        {:else}
          <div class="big">None scheduled</div>
        {/if}
      </div>
      <dl>
        <dt>Snoozes left</dt>
        <dd class="mono" data-testid="ad-snoozes">{s.snoozes}</dd>
        {#if s.snooze_refresh_at > now}
          <dt>Next snooze back</dt>
          <dd class="mono">{at(s.snooze_refresh_at)}</dd>
        {/if}
        <dt>Preroll-free time</dt>
        <dd class="mono">{s.preroll_free_s > 0 ? countdown(s.preroll_free_s) : 'None'}</dd>
      </dl>
      <Button
        size="sm"
        busy={busy === 'snooze'}
        disabled={!canSnooze || s.snoozes === 0 || !phase || phase.phase === 'running'}
        title={canSnooze ? 'Push the next ad back 5 minutes' : 'Sign out and in again in Settings → Twitch to snooze ads'}
        onclick={snooze}><AlarmClockOff size={14} />Snooze 5 min</Button
      >
      {#if !canSnooze}<p class="faint small">Snoozing needs a newer sign-in. Sign out and in again in Settings → Twitch.</p>{/if}
      <div class="run">
        <select class="input" aria-label="Ad length" bind:value={length}>
          {#each LENGTHS as l (l)}<option value={l}>{lengthText(l)}</option>{/each}
        </select>
        <Button size="sm" busy={busy === 'run'} disabled={phase?.phase === 'running'} onclick={run}><Tv size={14} />Run ad now</Button>
      </div>
      <p class="faint small">Your scenes stay as they are. Subs and Turbo viewers keep watching during ads.</p>
    </div>
  {/snippet}
</Popover>

<style>
  .ads {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: inherit;
    color: inherit;
    border-radius: 4px;
    padding: 1px 4px;
    margin: 0 -4px;
    font-variant-numeric: tabular-nums;
  }
  .ads:hover,
  .ads[aria-expanded='true'] {
    background: var(--bg-2);
    color: var(--text);
  }
  .ads.soon {
    color: var(--warn);
    font-weight: 600;
  }
  .ads.running {
    color: var(--live);
    font-weight: 600;
  }
  .pop {
    white-space: normal;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 6px 9px 9px;
    font-size: 12.5px;
  }
  .head {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-bottom: 9px;
    border-bottom: 1px solid var(--border);
  }
  .big {
    font-size: 18px;
    font-weight: 650;
  }
  dl {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 4px 12px;
  }
  dt {
    color: var(--text-muted);
  }
  dd {
    text-align: right;
  }
  .run {
    display: flex;
    gap: 6px;
  }
  .run select {
    flex: 1;
    min-width: 0;
  }
  .small {
    font-size: 11.5px;
    line-height: 1.4;
  }
</style>
