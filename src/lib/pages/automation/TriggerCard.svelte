<script lang="ts">
  import { api } from '$lib/api';
  import type { Action } from '$lib/bindings/Action';
  import type { EventKind } from '$lib/bindings/EventKind';
  import type { Permission } from '$lib/bindings/Permission';
  import type { Trigger } from '$lib/bindings/Trigger';
  import { KIND_LABELS } from '$lib/format';
  import { app } from '$lib/state/app.svelte';
  import { attempt, toasts } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import ConditionEditor from '$lib/widgets/ConditionEditor.svelte';
  import { Copy, Play } from '@lucide/svelte';
  import { fieldsFor } from '../alerts/alerts';
  import { TRIGGER_LABELS, triggerKinds } from './defaults';
  import { TRIGGER_ICONS } from './icons';
  import RewardPicker from './RewardPicker.svelte';
  import { commandPreview, every } from './describe';
  import { graphSteps } from './graph';
  import { MIN_TIMER_S, commandName, type Issue } from './validate';

  interface Props {
    t: Trigger;
    action: Action;
    issues: Issue[];
    onpatch: (patch: Partial<Trigger>) => void;
  }

  let { t, action, issues, onpatch }: Props = $props();

  const uid = `trg-${Math.random().toString(36).slice(2, 8)}`;
  const kinds = triggerKinds(Object.keys(KIND_LABELS) as EventKind[]);
  const PERMISSIONS: Array<[Permission, string]> = [
    ['everyone', 'Everyone'],
    ['subscriber', 'Subscribers and up'],
    ['vip', 'VIPs and up'],
    ['moderator', 'Moderators and the streamer'],
    ['broadcaster', 'Only the streamer']
  ];
  const Icon = $derived(TRIGGER_ICONS[t.type]);
  const runUrl = $derived(
    app.server ? `${app.server.base_url}/api/actions/${action.id}/run?token=${encodeURIComponent(app.server.token)}` : ''
  );

  function int(v: string, min: number, max: number): number | null {
    const n = Math.round(Number(v));
    return v.trim() === '' || !Number.isFinite(n) ? null : Math.min(max, Math.max(min, n));
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toasts.success('Copied');
    } catch {
      toasts.show('Copy failed. Select the address and copy it by hand.', 'error');
    }
  }
</script>

<div class="trigger" class:invalid={issues.some((i) => !i.warn)}>
  <header>
    <span class="icon"><Icon size={14} /></span>
    <span class="type">{TRIGGER_LABELS[t.type]}</span>
  </header>

  {#if t.type === 'command'}
    <div class="grid3">
      <div class="f">
        <label for="{uid}-name">Command</label>
        <div class="prefix">
          <span class="mono faint">!</span>
          <input
            id="{uid}-name"
            class="input mono"
            placeholder="so"
            spellcheck="false"
            aria-invalid={issues.some((i) => !i.warn) ? 'true' : undefined}
            value={t.name}
            oninput={(e) => {
              onpatch({ name: commandName(e.currentTarget.value) });
            }}
          />
        </div>
      </div>
      <div class="f">
        <label for="{uid}-aliases">Also answers to</label>
        <input
          id="{uid}-aliases"
          class="input mono"
          placeholder="shoutout, sh"
          spellcheck="false"
          value={t.aliases.join(', ')}
          onchange={(e) => {
            onpatch({ aliases: e.currentTarget.value
              .split(',')
              .map(commandName)
              .filter((x) => x) });
          }}
        />
      </div>
      <div class="f">
        <label for="{uid}-perm">Who can use it</label>
        <select
          id="{uid}-perm"
          class="input"
          value={t.permission}
          onchange={(e) => {
            onpatch({ permission: e.currentTarget.value as Permission });
          }}
        >
          {#each PERMISSIONS as [value, text] (value)}<option {value}>{text}</option>{/each}
        </select>
      </div>
      <div class="f">
        <label for="{uid}-ucd">Per-viewer cooldown (s)</label>
        <input
          id="{uid}-ucd"
          class="input"
          type="number"
          min="0"
          value={t.user_cooldown_s}
          oninput={(e) => {
            const n = int(e.currentTarget.value, 0, 86_400);
            if (n !== null) {
              onpatch({ user_cooldown_s: n });
            }
          }}
        />
      </div>
      <div class="f span2">
        <span class="label">In chat</span>
        <code class="preview mono">{commandPreview(t.name, graphSteps(action.graph))}</code>
      </div>
    </div>
    <p class="hint">Moderators and the streamer skip the per-viewer cooldown.</p>
  {:else if t.type === 'event'}
    <div class="f narrow">
      <label for="{uid}-kind">When this happens</label>
      <select
        id="{uid}-kind"
        class="input"
        value={t.kind}
        onchange={(e) => {
          onpatch({ kind: e.currentTarget.value as EventKind });
        }}
      >
        {#each kinds as k (k)}<option value={k}>{KIND_LABELS[k]}</option>{/each}
      </select>
    </div>
    <div class="f">
      <span class="label">Only if</span>
      <ConditionEditor
        group={t.conditions}
        fields={fieldsFor(t.kind)}
        emptyText="Every time."
        onchange={(g) => {
          onpatch({ conditions: g });
        }}
      />
    </div>
  {:else if t.type === 'timer'}
    <div class="grid3">
      <div class="f">
        <label for="{uid}-every">Every (minutes)</label>
        <input
          id="{uid}-every"
          class="input"
          type="number"
          min="0.5"
          step="0.5"
          aria-invalid={issues.some((i) => !i.warn) ? 'true' : undefined}
          value={t.interval_s / 60}
          oninput={(e) => {
            const n = Number(e.currentTarget.value);
            if (e.currentTarget.value.trim() !== '' && Number.isFinite(n)) {
              onpatch({ interval_s: Math.max(0, Math.round(n * 60)) });
            }
          }}
        />
      </div>
      <div class="f">
        <label for="{uid}-lines">Minimum chat lines</label>
        <input
          id="{uid}-lines"
          class="input"
          type="number"
          min="0"
          value={t.min_chat_lines}
          oninput={(e) => {
            const n = int(e.currentTarget.value, 0, 10_000);
            if (n !== null) {
              onpatch({ min_chat_lines: n });
            }
          }}
        />
      </div>
      <div class="f switch-cell">
        <Switch
          label="Only while live"
          showLabel
          checked={t.only_when_live}
          onchange={(v) => {
            onpatch({ only_when_live: v });
          }}
        />
      </div>
    </div>
    <p class="hint">
      Runs every {every(Math.max(MIN_TIMER_S, t.interval_s))}{t.min_chat_lines
        ? `, if at least ${t.min_chat_lines} chat messages came in since the last run`
        : ''}.
    </p>
  {:else if t.type === 'scene_changed'}
    <div class="f narrow">
      <label for="{uid}-scene">Scene</label>
      {#if app.obs.state === 'connected'}
        <select
          id="{uid}-scene"
          class="input"
          value={t.scene}
          onchange={(e) => {
            onpatch({ scene: e.currentTarget.value });
          }}
        >
          <option value="">Any scene</option>
          {#each app.obs.scenes as s (s)}<option value={s}>{s}</option>{/each}
          {#if t.scene && !app.obs.scenes.includes(t.scene)}<option value={t.scene}>{t.scene} (not in OBS)</option>{/if}
        </select>
      {:else}
        <input
          id="{uid}-scene"
          class="input"
          placeholder="Any scene"
          value={t.scene}
          oninput={(e) => {
            onpatch({ scene: e.currentTarget.value });
          }}
        />
      {/if}
    </div>
  {:else if t.type === 'manual'}
    <div class="manual">
      <Button size="sm" onclick={() => attempt(() => api.runAction(action.id))}><Play size={13} />Test</Button>
      <div class="f grow">
        <label for="{uid}-url">Stream Deck or web request (POST)</label>
        <div class="url">
          <input id="{uid}-url" class="input mono" readonly value={runUrl} onfocus={(e) => e.currentTarget.select()} />
          <IconButton label="Copy address" onclick={() => copy(runUrl)}><Copy /></IconButton>
        </div>
      </div>
    </div>
    <p class="hint">Keep this address private: it includes your access token.</p>
  {:else if t.type === 'redemption'}
    <div class="f narrow">
      <label for="{uid}-reward">Reward</label>
      <RewardPicker id="{uid}-reward" any rewardId={t.reward_id} rewardTitle={t.reward_title} onchange={(id, title) => onpatch({ reward_id: id, reward_title: title })} />
    </div>
    <p class="hint">Gives <code>{'{{user}}'}</code>, <code>{'{{reward}}'}</code>, <code>{'{{cost}}'}</code> and <code>{'{{input}}'}</code>. Rewards made on Twitch work too.</p>
  {:else if t.type === 'poll_begin' || t.type === 'poll_end'}
    <p class="hint">
      Runs when a poll {t.type === 'poll_begin' ? 'starts' : 'ends'}, from Castwright or Twitch.
      {#if t.type === 'poll_end'}<code>{'{{poll.winner}}'}</code> is the winning choice (empty on a tie).{/if}
    </p>
  {:else if t.type === 'prediction_begin' || t.type === 'prediction_end'}
    <p class="hint">
      Runs when a prediction {t.type === 'prediction_begin' ? 'starts' : 'is resolved or canceled'}.
      {#if t.type === 'prediction_end'}<code>{'{{prediction.winner}}'}</code> is the winning outcome; <code>{'{{prediction.status}}'}</code> is resolved or canceled.{/if}
    </p>
  {:else if t.type === 'ad_soon'}
    <div class="f narrow">
      <label for="{uid}-admin">Minutes before the ad</label>
      <input
        id="{uid}-admin"
        class="input"
        type="number"
        min="1"
        max="60"
        value={t.minutes_before}
        oninput={(e) => {
          const n = Number(e.currentTarget.value);
          if (e.currentTarget.value.trim() !== '' && Number.isFinite(n)) onpatch({ minutes_before: Math.min(60, Math.max(1, Math.round(n))) });
        }}
      />
    </div>
    <p class="hint">Runs once per ad, while live. Gives <code>{'{{ad.time}}'}</code> (like 1:00) and <code>{'{{ad.length}}'}</code>.</p>
  {:else if t.type === 'ad_begin' || t.type === 'ad_end'}
    <p class="hint">
      Runs when {t.type === 'ad_begin' ? 'an ad break starts, scheduled or run by hand' : 'an ad break is over'}. Gives <code>{'{{ad.length}}'}</code>.
    </p>
  {:else if t.type === 'song_changed'}
    <p class="hint">
      Runs when a new song starts. Gives <code>{'{{title}}'}</code>, <code>{'{{artist}}'}</code> and <code>{'{{album}}'}</code>. Pick the music source in Settings → Music.
    </p>
  {:else if t.type === 'stream_online'}
    <p class="hint">Runs when the stream goes live on Twitch.</p>
  {:else if t.type === 'stream_offline'}
    <p class="hint">Runs when the stream ends.</p>
  {/if}

  {#each issues as i (i.message)}
    <p class={i.warn ? 'warn' : 'error'} role={i.warn ? undefined : 'alert'}>{i.message}</p>
  {/each}
</div>

<style>
  .trigger {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 12px 12px;
    container-type: inline-size;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-1);
  }
  .trigger.invalid {
    border-color: color-mix(in srgb, var(--danger) 55%, var(--border));
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .icon {
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: var(--radius);
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .type {
    font-weight: 600;
  }
  .grid3 {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px 10px;
    align-items: end;
  }
  .span2 {
    grid-column: span 2;
  }
  @container (max-width: 520px) {
    .grid3 {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @container (max-width: 360px) {
    .grid3 {
      grid-template-columns: minmax(0, 1fr);
    }
    .span2 {
      grid-column: auto;
    }
  }
  .f {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .narrow {
    max-width: 320px;
  }
  .f > label,
  .label {
    font-size: 12px;
    font-weight: 550;
    color: var(--text-muted);
  }
  .switch-cell {
    justify-content: center;
    min-height: var(--row-h);
  }
  .prefix {
    position: relative;
  }
  .prefix span {
    position: absolute;
    left: 9px;
    top: 50%;
    transform: translateY(-50%);
  }
  .prefix input {
    padding-left: 17px;
  }
  .preview {
    display: flex;
    align-items: center;
    height: var(--row-h);
    padding: 0 10px;
    border-radius: var(--radius);
    background: var(--bg-2);
    border: 1px dashed var(--border-strong);
    color: var(--accent-text);
  }
  .manual {
    display: flex;
    align-items: flex-end;
    gap: 10px;
  }
  .url {
    display: flex;
    gap: 4px;
  }
  .hint {
    font-size: 12px;
    color: var(--text-faint);
  }
  .error {
    font-size: 12px;
    color: var(--danger);
  }
  .warn {
    font-size: 12px;
    color: var(--warn);
  }
</style>
