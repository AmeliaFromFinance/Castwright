<script lang="ts">
  import { api } from '$lib/api';
  import type { PollDraft } from '$lib/bindings/PollDraft';
  import type { PredictionAction } from '$lib/bindings/PredictionAction';
  import type { PredictionDraft } from '$lib/bindings/PredictionDraft';
  import NumberInput from '$lib/editor/ui/NumberInput.svelte';
  import { clock, useClock } from '$lib/overlay/clock.svelte';
  import { current } from '$lib/overlay/interact';
  import { toasts } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import EmptyState from '$lib/ui/EmptyState.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import { ChartColumn, Lock, Plus, Square, Trophy, X } from '@lucide/svelte';
  import { MAX_CHOICE, MAX_POLL_TITLE, MAX_PREDICTION_TITLE, POLL_LENGTHS, PREDICTION_WINDOWS, newPoll, newPrediction, pollIssues, predictionIssues } from './forms';
  import LiveResults from './LiveResults.svelte';
  import { interact } from './store.svelte';

  $effect(() => useClock());
  const now = $derived(clock.now);

  /** Results stay here until a new one starts. */
  const poll = $derived(current(interact.poll, now, 86_400));
  const prediction = $derived(current(interact.prediction, now, 86_400));

  let pollDraft = $state<PollDraft>(newPoll());
  let predictionDraft = $state<PredictionDraft>(newPrediction());
  let pollTried = $state(false);
  let predictionTried = $state(false);
  let newPollOpen = $state(false);
  let newPredictionOpen = $state(false);
  let busy = $state('');
  let pointsVoting = $state(false);

  const pollErr = $derived(pollTried ? pollIssues(pollDraft) : {});
  const predErr = $derived(predictionTried ? predictionIssues(predictionDraft) : {});
  const showPollForm = $derived(!poll?.running && (!poll || newPollOpen));
  const showPredictionForm = $derived(!prediction?.running && (!prediction || newPredictionOpen));

  const secs = (s: number) => (s < 60 ? `${s} seconds` : `${s / 60} minute${s === 60 ? '' : 's'}`);

  async function run<T>(key: string, fn: () => Promise<T>, done?: string): Promise<T | undefined> {
    busy = key;
    try {
      const r = await fn();
      if (done) toasts.success(done);
      return r;
    } catch (e) {
      toasts.error(e);
      return undefined;
    } finally {
      busy = '';
    }
  }

  async function startPoll(e: SubmitEvent) {
    e.preventDefault();
    pollTried = true;
    if (Object.keys(pollIssues(pollDraft)).length) return;
    const draft = { ...$state.snapshot(pollDraft), points_per_vote: pointsVoting ? pollDraft.points_per_vote : 0 };
    const ev = await run('poll', () => api.startPoll(draft), 'Poll started');
    if (ev) {
      interact.setPoll(ev);
      pollDraft = newPoll();
      pollTried = false;
      newPollOpen = false;
    }
  }

  async function endPoll() {
    const ev = await run('end-poll', () => api.endPoll(), 'Poll ended');
    if (ev) interact.setPoll(ev);
  }

  async function startPrediction(e: SubmitEvent) {
    e.preventDefault();
    predictionTried = true;
    if (Object.keys(predictionIssues(predictionDraft)).length) return;
    const ev = await run('prediction', () => api.startPrediction($state.snapshot(predictionDraft)), 'Prediction started');
    if (ev) {
      interact.setPrediction(ev);
      predictionDraft = newPrediction();
      predictionTried = false;
      newPredictionOpen = false;
    }
  }

  async function endPrediction(action: PredictionAction, outcome = '', label = '') {
    const done = action === 'lock' ? 'Prediction locked' : action === 'cancel' ? 'Prediction canceled, points refunded' : `${label} won`;
    const ev = await run(`pr-${action}-${outcome}`, () => api.endPrediction(action, outcome), done);
    if (ev) interact.setPrediction(ev);
  }
</script>

{#snippet options(list: string[], max: number, what: string, errs: Record<string, string>, setList: (l: string[]) => void)}
  <fieldset class="opts">
    <legend class="label">{what === 'choice' ? 'Choices' : 'Outcomes'}</legend>
    {#each list as c, i (i)}
      <div class="opt">
        <span class="n faint mono">{i + 1}</span>
        <input
          class="input"
          aria-label="{what === 'choice' ? 'Choice' : 'Outcome'} {i + 1}"
          maxlength={MAX_CHOICE + 5}
          aria-invalid={errs[`option.${i}`] ? 'true' : undefined}
          value={c}
          oninput={(e) => setList(list.map((x, j) => (j === i ? e.currentTarget.value : x)))}
        />
        <IconButton size="sm" label="Remove {what} {i + 1}" disabled={list.length <= 2} onclick={() => setList(list.filter((_, j) => j !== i))}><X /></IconButton>
      </div>
      {#if errs[`option.${i}`]}<p class="error">{errs[`option.${i}`]}</p>{/if}
    {/each}
    {#if errs.options}<p class="error">{errs.options}</p>{/if}
    {#if list.length < max}
      <Button size="sm" variant="ghost" onclick={() => setList([...list, ''])}><Plus size={14} />Add {what}</Button>
    {/if}
  </fieldset>
{/snippet}

{#if interact.pollsError}
  <div class="center">
    <EmptyState title="Polls and predictions aren't available" body={interact.pollsError}>
      {#snippet icon()}<ChartColumn size={28} />{/snippet}
    </EmptyState>
  </div>
{:else}
  <div class="cols">
    <section class="col" aria-label="Poll">
      <div class="head">
        <h2 class="grow">Poll</h2>
        {#if poll?.running}<span class="live">Live</span>{/if}
      </div>
      {#if showPollForm}
        <form class="form" onsubmit={startPoll} novalidate aria-label="Start a poll">
          <div class="f">
            <label for="poll-title">Question</label>
            <input id="poll-title" class="input" maxlength={MAX_POLL_TITLE + 10} placeholder="Which map next?" aria-invalid={pollErr.title ? 'true' : undefined} bind:value={pollDraft.title} />
            {#if pollErr.title}<p class="error">{pollErr.title}</p>{/if}
          </div>
          {@render options(pollDraft.choices, 5, 'choice', pollErr, (l) => (pollDraft.choices = l))}
          <div class="two">
            <div class="f">
              <label for="poll-len">Runs for</label>
              <select id="poll-len" class="input" bind:value={pollDraft.duration_s}>
                {#each POLL_LENGTHS as s (s)}<option value={s}>{secs(s)}</option>{/each}
              </select>
            </div>
            <div class="f">
              <span class="label">Extra votes for channel points</span>
              <div class="pts">
                <Switch label="Extra votes for channel points" checked={pointsVoting} onchange={(v) => (pointsVoting = v)} />
                {#if pointsVoting}
                  <NumberInput label="Points per extra vote" unit="pts" min={1} max={1_000_000} value={pollDraft.points_per_vote || 100} oninput={(v) => (pollDraft.points_per_vote = Math.round(v))} />
                {/if}
              </div>
            </div>
          </div>
          <div class="actions">
            {#if poll}<Button variant="ghost" onclick={() => (newPollOpen = false)}>Back to result</Button>{/if}
            <Button variant="primary" type="submit" busy={busy === 'poll'}><ChartColumn size={14} />Start poll</Button>
          </div>
        </form>
      {:else if poll}
        <div class="card">
          <LiveResults live={poll} {now} />
          <div class="actions">
            {#if poll.running}
              <Button variant="danger" busy={busy === 'end-poll'} onclick={endPoll}><Square size={13} />End poll now</Button>
            {:else}
              <Button variant="primary" onclick={() => (newPollOpen = true)}><Plus size={14} />New poll</Button>
            {/if}
          </div>
        </div>
      {/if}
    </section>

    <section class="col side" aria-label="Prediction">
      <div class="head">
        <h2 class="grow">Prediction</h2>
        {#if prediction?.open}<span class="live">Live</span>{:else if prediction?.running}<span class="tag">Locked</span>{/if}
      </div>
      {#if showPredictionForm}
        <form class="form" onsubmit={startPrediction} novalidate aria-label="Start a prediction">
          <div class="f">
            <label for="pred-title">Question</label>
            <input id="pred-title" class="input" maxlength={MAX_PREDICTION_TITLE + 10} placeholder="Will we win this round?" aria-invalid={predErr.title ? 'true' : undefined} bind:value={predictionDraft.title} />
            {#if predErr.title}<p class="error">{predErr.title}</p>{/if}
          </div>
          {@render options(predictionDraft.outcomes, 10, 'outcome', predErr, (l) => (predictionDraft.outcomes = l))}
          <div class="f narrow">
            <label for="pred-win">Open for</label>
            <select id="pred-win" class="input" bind:value={predictionDraft.window_s}>
              {#each PREDICTION_WINDOWS as s (s)}<option value={s}>{secs(s)}</option>{/each}
            </select>
          </div>
          <div class="actions">
            {#if prediction}<Button variant="ghost" onclick={() => (newPredictionOpen = false)}>Back to result</Button>{/if}
            <Button variant="primary" type="submit" busy={busy === 'prediction'}><Trophy size={14} />Start prediction</Button>
          </div>
        </form>
      {:else if prediction}
        <div class="card">
          <LiveResults live={prediction} {now} />
          {#if prediction.running}
            <p class="label">Pick the winner to pay out</p>
            <div class="winners">
              {#each prediction.choices as c (c.id)}
                <Button size="sm" busy={busy === `pr-resolve-${c.id}`} onclick={() => endPrediction('resolve', c.id, c.title)}><Trophy size={13} />{c.title} won</Button>
              {/each}
            </div>
            <div class="actions">
              {#if prediction.open}
                <Button busy={busy === 'pr-lock-'} onclick={() => endPrediction('lock')}><Lock size={13} />Lock now</Button>
              {/if}
              <Button variant="danger" busy={busy === 'pr-cancel-'} onclick={() => endPrediction('cancel')}><X size={13} />Cancel and refund</Button>
            </div>
          {:else}
            <div class="actions">
              <Button variant="primary" onclick={() => (newPredictionOpen = true)}><Plus size={14} />New prediction</Button>
            </div>
          {/if}
        </div>
      {/if}
    </section>
  </div>
{/if}

<style>
  .center {
    flex: 1;
    display: grid;
    place-items: center;
  }
  .cols {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
  .col {
    min-height: 0;
    overflow: auto;
    padding: 14px 18px 24px;
  }
  .side {
    border-left: 1px solid var(--border);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 560px;
    margin-bottom: 12px;
    min-height: 26px;
  }
  h2 {
    font-size: 15px;
  }
  .live,
  .tag {
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .live {
    background: var(--live);
    color: var(--on-live);
  }
  .tag {
    background: var(--bg-3);
    color: var(--text-muted);
  }
  .card,
  .form {
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-width: 560px;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-1);
  }
  .f {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .narrow {
    max-width: 240px;
  }
  .f > label,
  .label {
    font-size: 12px;
    font-weight: 550;
    color: var(--text-muted);
  }
  .opts {
    border: 0;
    padding: 0;
    margin: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;
  }
  .opts legend {
    margin-bottom: 5px;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
  }
  .n {
    width: 14px;
    font-size: 12px;
    text-align: right;
  }
  .two {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 10px;
  }
  .pts {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: var(--row-h);
  }
  .actions,
  .winners {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .actions {
    justify-content: flex-end;
  }
  .error {
    font-size: 12px;
    color: var(--danger);
  }
</style>
