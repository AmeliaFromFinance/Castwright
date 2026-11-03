<script lang="ts">
  import type { Layer } from '$lib/bindings/Layer';
  import type { TimerAction } from '$lib/bindings/TimerAction';
  import { formatClock, formatDuration } from '$lib/overlay/format';
  import { clock, useClock } from '$lib/overlay/clock.svelte';
  import { timerElapsed } from '$lib/overlay/timer';
  import { app } from '$lib/state/app.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { toasts } from '$lib/state/toast.svelte';
  import { Link, Pause, Play, RotateCcw } from '@lucide/svelte';
  import { timerButtons, timerState } from '../timer-actions';
  import Prop from '../ui/Prop.svelte';

  interface Props {
    layer: Layer;
    ontimer: (action: TimerAction) => void;
  }

  let { layer, ontimer }: Props = $props();

  $effect(() => useClock());

  const run = $derived(app.timers[layer.id]);
  const status = $derived(timerState(layer, run, clock.now));
  const countdown = $derived(layer.kind.type === 'timer' && layer.kind.mode === 'countdown');
  const length = $derived(layer.kind.type === 'timer' ? layer.kind.duration_s * 1000 : 0);
  const note = $derived.by(() => {
    if (!run || !status) return 'Not started. Until you start it, it counts from when the overlay loads.';
    const at = countdown ? Math.max(0, length - timerElapsed(run, clock.now)) : timerElapsed(run, clock.now);
    if (status === 'done') return 'Finished.';
    if (status === 'running') return countdown ? `Running. Ends at ${formatClock(new Date(run.at + length - run.elapsed_ms))}.` : 'Running.';
    if (status === 'paused') return `Paused at ${formatDuration(Math.ceil(at / 1000 - 1e-6))}.`;
    return 'Reset. Waiting to start.';
  });
  const icons = { start: Play, resume: Play, pause: Pause, reset: RotateCcw } as const;
  const link = $derived(app.server ? `${app.server.base_url}/api/layers/${layer.id}/timer/toggle?token=${encodeURIComponent(app.server.token)}` : '');

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      toasts.success('Link copied. Send it as a POST to pause or resume.');
    } catch {
      toasts.show(link);
    }
  }
</script>

{#if status}
  <Prop label="Control" stacked hint={note}>
    <div class="row" role="group" aria-label="Timer controls">
      {#each timerButtons(status) as b (b.action)}
        {@const Icon = icons[b.action as keyof typeof icons]}
        <Button size="sm" variant={b.action === 'reset' ? 'ghost' : 'secondary'} disabled={b.disabled} onclick={() => ontimer(b.action)}>
          <Icon size={13} />{b.label}
        </Button>
      {/each}
      {#if link}
        <Button size="sm" variant="ghost" onclick={copyLink} title="For a Stream Deck: pauses or resumes this timer"><Link size={13} />Copy link</Button>
      {/if}
    </div>
  </Prop>
{/if}

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
</style>
