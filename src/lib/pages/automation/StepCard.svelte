<script lang="ts">
  import type { Action } from '$lib/bindings/Action';
  import type { HttpMethod } from '$lib/bindings/HttpMethod';
  import type { Step } from '$lib/bindings/Step';
  import type { Toggle } from '$lib/bindings/Toggle';
  import TemplateField from '$lib/editors/TemplateField.svelte';
  import type { Token } from '$lib/editors/tokens';
  import { app } from '$lib/state/app.svelte';
  import Slider from '$lib/ui/Slider.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import AssetPicker from '$lib/widgets/AssetPicker.svelte';
  import ConditionEditor from '$lib/widgets/ConditionEditor.svelte';
  import { MODE_LABELS, MODE_ORDER } from '$lib/widgets/chat/moderation';
  import { ANNOUNCE_COLORS, REWARD_STATES, STEP_LABELS } from './defaults';
  import RewardPicker from './RewardPicker.svelte';
  import { fieldsForAction } from './describe';
  import { VAR_KEY_HELP, type Issue } from './validate';

  interface Props {
    step: Step;
    nodeId: string;
    action: Action;
    tokens: Token[];
    /** Problems with this node. */
    issues: Issue[];
    onpatch: (patch: Record<string, unknown>) => void;
  }

  let { step, nodeId, action, tokens, issues, onpatch }: Props = $props();

  const uid = `step-${Math.random().toString(36).slice(2, 8)}`;
  const mine = $derived(issues);
  const obsOn = $derived(app.obs.state === 'connected');
  const overlays = $derived(app.project?.overlays ?? []);
  const otherActions = $derived((app.project?.actions ?? []).filter((a) => a.id !== action.id));
  const varKeys = $derived(Object.keys(app.vars).sort());
  const toggleText = (on: string, off: string): Array<[Toggle, string]> => [
    ['on', on],
    ['off', off],
    ['toggle', 'Toggle']
  ];

  function set(k: string, v: unknown) {
    onpatch({ [k]: v });
  }

  function num(v: string, min: number, max: number): number | null {
    const n = Number(v);
    return v.trim() === '' || !Number.isFinite(n) ? null : Math.min(max, Math.max(min, n));
  }
</script>

{#snippet text(label: string, field: string, value: string, opts: { multiline?: boolean; placeholder?: string; chips?: boolean } = {})}
  <TemplateField
    {label}
    {value}
    tokens={opts.chips === false ? [] : tokens}
    multiline={opts.multiline}
    placeholder={opts.placeholder}
    onchange={(v) => set(field, v)}
  />
{/snippet}

{#snippet number(label: string, field: string, value: number, min: number, max: number, step = 1, scale = 1)}
  <div class="f">
    <label for="{uid}-{field}">{label}</label>
    <input
      id="{uid}-{field}"
      class="input"
      type="number"
      {min}
      {max}
      {step}
      value={value / scale}
      oninput={(e) => {
        const n = num(e.currentTarget.value, min, max);
        if (n !== null) set(field, Math.round(n * scale * 1000) / 1000);
      }}
    />
  </div>
{/snippet}

{#snippet toggle(label: string, value: Toggle, options: Array<[Toggle, string]>)}
  <div class="f">
    <label for="{uid}-state">{label}</label>
    <select id="{uid}-state" class="input" {value} onchange={(e) => set('state', e.currentTarget.value)}>
      {#each options as [v, t] (v)}<option value={v}>{t}</option>{/each}
    </select>
  </div>
{/snippet}

{#snippet sceneSelect(label: string, field: string, value: string, anyLabel?: string)}
  <div class="f">
    <label for="{uid}-{field}">{label}</label>
    {#if obsOn}
      <select id="{uid}-{field}" class="input" {value} onchange={(e) => set(field, e.currentTarget.value)}>
        <option value="">{anyLabel ?? 'Pick a scene'}</option>
        {#each app.obs.scenes as s (s)}<option value={s}>{s}</option>{/each}
        {#if value && !app.obs.scenes.includes(value)}<option {value}>{value} (not in OBS)</option>{/if}
      </select>
    {:else}
      <input id="{uid}-{field}" class="input" placeholder={anyLabel ?? 'Scene name'} {value} oninput={(e) => set(field, e.currentTarget.value)} />
    {/if}
  </div>
{/snippet}

{#snippet varKey(value: string, persist: boolean)}
  <div class="f">
    <label for="{uid}-key">Variable</label>
    <input
      id="{uid}-key"
      class="input mono"
      list="{uid}-vars"
      placeholder="counter.deaths"
      spellcheck="false"
      title={VAR_KEY_HELP}
      aria-invalid={mine.some((i) => !i.warn) ? 'true' : undefined}
      {value}
      oninput={(e) => set('key', e.currentTarget.value.trim())}
    />
    <datalist id="{uid}-vars">
      {#each varKeys as k (k)}<option value={k}></option>{/each}
    </datalist>
  </div>
  <div class="f switch-cell">
    <Switch label="Keep after restart" showLabel checked={persist} onchange={(v) => set('persist', v)} />
  </div>
{/snippet}

<div class="step" class:invalid={mine.some((i) => !i.warn)} data-step={nodeId}>
  <header>
    <span class="label">{STEP_LABELS[step.type]}</span>
  </header>

  <div class="fields">
    {#if step.type === 'chat_send'}
      {@render text('Message', 'message', step.message, { placeholder: 'Thanks for the follow, {{name}}!' })}
      <div class="row gap">
        <Switch label="Send as the bot" showLabel checked={step.as_bot} onchange={(v) => set('as_bot', v)} />
        <Switch label="Reply to the message that started it" showLabel checked={step.reply} onchange={(v) => set('reply', v)} />
      </div>
    {:else if step.type === 'chat_announce'}
      {@render text('Message', 'message', step.message)}
      <div class="grid2">
        <div class="f">
          <label for="{uid}-color">Colour</label>
          <select id="{uid}-color" class="input" value={step.color || 'primary'} onchange={(e) => set('color', e.currentTarget.value)}>
            {#each ANNOUNCE_COLORS as c (c)}<option value={c}>{c === 'primary' ? 'Channel colour' : c[0]!.toUpperCase() + c.slice(1)}</option>{/each}
          </select>
        </div>
      </div>
    {:else if step.type === 'shoutout'}
      <div class="grid2">
        {@render text('Who', 'user', step.user, { placeholder: '{{arg1}}' })}
        {@render text('Chat message (optional)', 'message', step.message, { placeholder: 'Go follow {{arg1}}!' })}
      </div>
    {:else if step.type === 'create_clip'}
      <p class="hint">Clips the last 30 seconds. The link is saved in <code>last.clip.url</code>.</p>
    {:else if step.type === 'create_marker'}
      {@render text('Description (optional)', 'description', step.description)}
    {:else if step.type === 'run_ad'}
      <div class="grid2">
        <div class="f">
          <label for="{uid}-ad">Length</label>
          <select id="{uid}-ad" class="input" value={step.length_s} onchange={(e) => set('length_s', Number(e.currentTarget.value))}>
            {#each [30, 60, 90, 120, 150, 180] as s (s)}<option value={s}>{s < 60 ? `${s} seconds` : `${s / 60} minute${s === 60 ? '' : 's'}`}</option>{/each}
          </select>
        </div>
      </div>
    {:else if step.type === 'set_stream_info'}
      <div class="grid2">
        {@render text('Title (blank keeps it)', 'title', step.title)}
        {@render text('Category (blank keeps it)', 'category', step.category, { chips: false, placeholder: 'Just Chatting' })}
      </div>
    {:else if step.type === 'timeout_user'}
      <div class="grid3">
        {@render text('Who', 'user', step.user, { placeholder: '{{arg1}}' })}
        {@render number('Seconds', 'duration_s', step.duration_s, 1, 1_209_600)}
        {@render text('Reason (optional)', 'reason', step.reason, { chips: false })}
      </div>
    {:else if step.type === 'delete_message'}
      {@render text('Message id (blank = the one that started this)', 'message_id', step.message_id)}
    {:else if step.type === 'set_chat_mode'}
      <div class="grid3">
        <div class="f">
          <label for="{uid}-mode">Mode</label>
          <select id="{uid}-mode" class="input" value={step.mode} onchange={(e) => set('mode', e.currentTarget.value)}>
            {#each MODE_ORDER as m (m)}<option value={m}>{MODE_LABELS[m]}</option>{/each}
          </select>
        </div>
        {@render toggle('Turn it', step.state, toggleText('On', 'Off'))}
        {#if step.mode === 'slow'}
          {@render number('Seconds between messages', 'value', step.value || 30, 3, 120)}
        {:else if step.mode === 'followers'}
          {@render number('Followed for (minutes)', 'value', step.value, 0, 129_600)}
        {/if}
      </div>
    {:else if step.type === 'delay'}
      <div class="grid3">
        {@render number('Wait (seconds)', 'ms', step.ms, 0, 600, 0.5, 1000)}
      </div>
    {:else if step.type === 'set_variable'}
      <div class="grid3">
        {@render varKey(step.key, step.persist)}
      </div>
      {@render text('Value', 'value', step.value, { placeholder: 'Numbers are stored as numbers' })}
    {:else if step.type === 'add_to_variable'}
      <div class="grid3">
        {@render varKey(step.key, step.persist)}
        {@render number('Add', 'amount', step.amount, -1_000_000, 1_000_000, 1)}
      </div>
      <p class="hint">Use a negative number to subtract. Missing variables start at 0.</p>
    {:else if step.type === 'switch_scene'}
      <div class="grid2">{@render sceneSelect('Scene', 'scene', step.scene)}</div>
    {:else if step.type === 'set_source_visible'}
      <div class="grid3">
        {@render sceneSelect('Scene', 'scene', step.scene, 'Current scene')}
        <div class="f">
          <label for="{uid}-source">Source</label>
          <input
            id="{uid}-source"
            class="input"
            list="{uid}-sources"
            placeholder="Source name"
            value={step.source}
            oninput={(e) => set('source', e.currentTarget.value)}
          />
          <datalist id="{uid}-sources">
            {#each app.obs.scene_items as it (it.id)}<option value={it.name}></option>{/each}
          </datalist>
        </div>
        {@render toggle('Make it', step.state, toggleText('Visible', 'Hidden'))}
      </div>
    {:else if step.type === 'set_input_mute'}
      <div class="grid3">
        <div class="f">
          <label for="{uid}-input">Audio source</label>
          {#if obsOn && app.obs.inputs.length}
            <select id="{uid}-input" class="input" value={step.input} onchange={(e) => set('input', e.currentTarget.value)}>
              <option value="">Pick a source</option>
              {#each app.obs.inputs as inp (inp.name)}<option value={inp.name}>{inp.name}</option>{/each}
              {#if step.input && !app.obs.inputs.some((x) => x.name === step.input)}<option value={step.input}>{step.input} (not in OBS)</option>{/if}
            </select>
          {:else}
            <input id="{uid}-input" class="input" placeholder="Mic" value={step.input} oninput={(e) => set('input', e.currentTarget.value)} />
          {/if}
        </div>
        {@render toggle('Make it', step.state, toggleText('Muted', 'Unmuted'))}
      </div>
    {:else if step.type === 'recording'}
      <div class="grid3">{@render toggle('Recording', step.state, toggleText('Start', 'Stop'))}</div>
    {:else if step.type === 'save_replay'}
      <p class="hint">Saves the OBS replay buffer. The buffer has to be running.</p>
    {:else if step.type === 'set_layer_visible'}
      {@const ov = overlays.find((o) => o.id === step.overlay_id)}
      <div class="grid3">
        <div class="f">
          <label for="{uid}-ov">Overlay</label>
          <select
            id="{uid}-ov"
            class="input"
            value={step.overlay_id}
            onchange={(e) => onpatch({ overlay_id: e.currentTarget.value, layer_id: '' })}
          >
            <option value="">Pick an overlay</option>
            {#each overlays as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
          </select>
        </div>
        <div class="f">
          <label for="{uid}-layer">Layer</label>
          <select id="{uid}-layer" class="input" value={step.layer_id} disabled={!ov} onchange={(e) => set('layer_id', e.currentTarget.value)}>
            <option value="">Pick a layer</option>
            {#each ov?.layers ?? [] as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
          </select>
        </div>
        {@render toggle('Make it', step.state, toggleText('Visible', 'Hidden'))}
      </div>
    {:else if step.type === 'play_alert'}
      <div class="grid2">
        {@render text('Title', 'title', step.title)}
        {@render text('Message', 'message', step.message)}
        <div class="f">
          <label for="{uid}-img">Image</label>
          <AssetPicker id="{uid}-img" kind="image" label="Image" value={step.image} onchange={(v) => set('image', v)} />
        </div>
        <div class="f">
          <label for="{uid}-snd">Sound</label>
          <AssetPicker id="{uid}-snd" kind="audio" label="Sound" value={step.sound} onchange={(v) => set('sound', v)} />
        </div>
        {@render number('On screen (seconds)', 'duration_ms', step.duration_ms, 0.5, 120, 0.5, 1000)}
      </div>
    {:else if step.type === 'pause_alerts'}
      <div class="grid3">{@render toggle('Alerts', step.state, toggleText('Pause', 'Resume'))}</div>
      <p class="hint">The alert on screen still finishes. New alerts wait until you resume.</p>
    {:else if step.type === 'skip_alert'}
      <p class="hint">Ends the alert on screen. The next one in the queue starts after it.</p>
    {:else if step.type === 'play_sound'}
      <div class="grid2">
        <div class="f">
          <label for="{uid}-src">Sound</label>
          <AssetPicker id="{uid}-src" kind="audio" label="Sound" value={step.src} onchange={(v) => set('src', v)} />
        </div>
        <div class="f">
          <label for="{uid}-vol">Volume</label>
          <Slider id="{uid}-vol" label="Volume" min={0} max={100} value={step.volume} format={(n) => `${n}%`} oninput={(n) => set('volume', n)} />
        </div>
      </div>
    {:else if step.type === 'http_request'}
      <div class="url-row">
        <div class="f method">
          <label for="{uid}-method">Method</label>
          <select id="{uid}-method" class="input" value={step.method} onchange={(e) => set('method', e.currentTarget.value as HttpMethod)}>
            {#each ['get', 'post', 'put', 'patch', 'delete'] as m (m)}<option value={m}>{m.toUpperCase()}</option>{/each}
          </select>
        </div>
        {@render text('Address', 'url', step.url, { placeholder: 'https://example.com/hook', chips: false })}
      </div>
      {#if step.method !== 'get'}
        {@render text('Body', 'body', step.body, { multiline: true, placeholder: '{"user": "{{name}}"}' })}
      {/if}
      <div class="grid2">
        <div class="f">
          <label for="{uid}-save">Save the answer in (optional)</label>
          <input
            id="{uid}-save"
            class="input mono"
            placeholder="last.http.reply"
            spellcheck="false"
            value={step.save_to}
            oninput={(e) => set('save_to', e.currentTarget.value.trim())}
          />
        </div>
      </div>
    {:else if step.type === 'run_script'}
      {#await import('$lib/editors/CodeEditor.svelte')}
        <div class="code-wait" aria-busy="true"></div>
      {:then { default: CodeEditor }}
        <CodeEditor label="Script" value={step.code} onchange={(v) => set('code', v)} />
      {/await}
      <details class="ref">
        <summary>Script reference</summary>
        <dl>
          <dt><code>get("key")</code></dt>
          <dd>Read a variable or a trigger value (missing gives <code>()</code>).</dd>
          <dt><code>set("key", value)</code> · <code>save("key", value)</code></dt>
          <dd>Set a variable for this session, or keep it after restart.</dd>
          <dt><code>args.name</code> · <code>args.arg1</code> · <code>args.input</code></dt>
          <dd>What started the run. Read only.</dd>
          <dt><code>chat("text")</code> · <code>log("text")</code></dt>
          <dd>Post in chat as the bot, or write to the run log.</dd>
          <dt><code>random(1, 6)</code> · <code>now_ms()</code></dt>
          <dd>Whole number in a range; current time in milliseconds.</dd>
        </dl>
        <p class="hint">Scripts use Rhai, which reads like JavaScript. They stop after 2 seconds.</p>
      </details>
    {:else if step.type === 'if'}
      <div class="f">
        <span class="sub">Only if</span>
        <ConditionEditor
          group={step.conditions}
          fields={fieldsForAction(action, app.vars)}
          emptyText="Always true. Add a condition."
          onchange={(g) => set('conditions', g)}
        />
      </div>
      <p class="hint">Draw lines from this node to choose what runs next. Click a line's label to switch it between Then, Otherwise and Always.</p>
    {:else if step.type === 'run_action'}
      <div class="grid2">
        <div class="f">
          <label for="{uid}-act">Action</label>
          <select id="{uid}-act" class="input" value={step.action_id} onchange={(e) => set('action_id', e.currentTarget.value)}>
            <option value="">Pick an action</option>
            {#each otherActions as a (a.id)}<option value={a.id}>{a.group ? `${a.group} · ` : ''}{a.name}</option>{/each}
          </select>
        </div>
      </div>
      <p class="hint">Runs that action here, with this run's values, starting from its Button trigger (or all its triggers). Its cooldown is ignored.</p>
    {:else if step.type === 'finish_redemption'}
      <div class="grid2">
        <div class="f">
          <label for="{uid}-fin">Do</label>
          <select id="{uid}-fin" class="input" value={step.refund ? 'refund' : 'complete'} onchange={(e) => set('refund', e.currentTarget.value === 'refund')}>
            <option value="complete">Mark it complete</option>
            <option value="refund">Refund the points</option>
          </select>
        </div>
      </div>
      <p class="hint">For the redemption that started this run. Only rewards made in Castwright can be completed or refunded.</p>
    {:else if step.type === 'set_reward_state' || step.type === 'set_reward_cost'}
      <div class="grid2">
        <div class="f">
          <label for="{uid}-rw">Reward</label>
          <RewardPicker id="{uid}-rw" onlyMine rewardId={step.reward_id} rewardTitle={step.reward_title} onchange={(id, title) => onpatch({ reward_id: id, reward_title: title })} />
        </div>
        {#if step.type === 'set_reward_state'}
          <div class="f">
            <label for="{uid}-rs">Make it</label>
            <select id="{uid}-rs" class="input" value={step.state} onchange={(e) => set('state', e.currentTarget.value)}>
              {#each REWARD_STATES as [v, label] (v)}<option value={v}>{label}</option>{/each}
            </select>
          </div>
        {:else}
          {@render text('New cost', 'cost', step.cost, { placeholder: '500 or {{counter.price}}' })}
        {/if}
      </div>
      <p class="hint">Paused rewards stay visible but can't be redeemed. Turned off rewards are hidden.</p>
    {:else if step.type === 'start_poll' || step.type === 'start_prediction'}
      {@const poll = step.type === 'start_poll'}
      {@const list = step.type === 'start_poll' ? step.choices : step.outcomes}
      {@const field = poll ? 'choices' : 'outcomes'}
      {@render text('Question', 'title', step.title, { placeholder: poll ? 'Which map next?' : 'Will we win this round?' })}
      <div class="f">
        <span class="sub">{poll ? 'Choices' : 'Outcomes'}</span>
        {#each list as c, i (i)}
          <div class="opt-row">
            <input
              class="input"
              aria-label="{poll ? 'Choice' : 'Outcome'} {i + 1}"
              value={c}
              oninput={(e) => set(field, list.map((x, j) => (j === i ? e.currentTarget.value : x)))}
            />
            <button type="button" class="mini" disabled={list.length <= 2} aria-label="Remove {i + 1}" onclick={() => set(field, list.filter((_, j) => j !== i))}>×</button>
          </div>
        {/each}
        {#if list.length < (poll ? 5 : 10)}
          <button type="button" class="add" onclick={() => set(field, [...list, ''])}>+ Add {poll ? 'choice' : 'outcome'}</button>
        {/if}
      </div>
      <div class="grid3">
        {#if step.type === 'start_poll'}
          {@render number('Runs for (seconds)', 'duration_s', step.duration_s, 15, 1800)}
          {@render number('Extra vote cost (0 = off)', 'points_per_vote', step.points_per_vote, 0, 1_000_000)}
        {:else}
          {@render number('Open for (seconds)', 'window_s', step.window_s, 30, 1800)}
        {/if}
      </div>
    {:else if step.type === 'end_poll'}
      <p class="hint">Ends the running poll early. Viewers see the result.</p>
    {:else if step.type === 'end_prediction'}
      <div class="grid2">
        <div class="f">
          <label for="{uid}-pa">Do</label>
          <select id="{uid}-pa" class="input" value={step.action} onchange={(e) => set('action', e.currentTarget.value)}>
            <option value="lock">Lock (stop new predictions)</option>
            <option value="resolve">Pick the winner</option>
            <option value="cancel">Cancel and refund</option>
          </select>
        </div>
        {#if step.action === 'resolve'}
          {@render text('Winning outcome', 'winner', step.winner, { placeholder: 'Yes, or 1 for the first' })}
        {/if}
      </div>
    {:else if step.type === 'stop'}
      <p class="hint">Ends the whole run. Nothing after it runs.</p>
    {:else if step.type === 'log'}
      {@render text('Text', 'message', step.message)}
    {/if}

    {#each mine as i (i.message)}
      <p class={i.warn ? 'warn' : 'error'} role={i.warn ? undefined : 'alert'}>{i.message}</p>
    {/each}
  </div>
</div>

<style>
  .step {
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-1);
  }
  .step.invalid {
    border-color: color-mix(in srgb, var(--danger) 55%, var(--border));
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 6px 0 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  }
  .label {
    font-weight: 600;
    font-size: 12.5px;
  }
  .fields {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px 12px;
    container-type: inline-size;
  }
  .opt-row {
    display: flex;
    gap: 4px;
  }
  .mini,
  .add {
    color: var(--text-muted);
    border-radius: var(--radius);
  }
  .mini {
    width: 28px;
    flex: none;
  }
  .mini:hover:not(:disabled),
  .add:hover {
    color: var(--text);
    background: var(--bg-2);
  }
  .mini:disabled {
    opacity: 0.35;
  }
  .add {
    align-self: flex-start;
    padding: 4px 6px;
    font-size: 12px;
  }
  .grid2,
  .grid3 {
    display: grid;
    gap: 8px 10px;
    align-items: end;
  }
  .grid2 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .grid3 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .grid2 > :global(.tpl),
  .grid3 > :global(.tpl) {
    align-self: start;
  }
  @container (max-width: 520px) {
    .grid3 {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @container (max-width: 360px) {
    .grid2,
    .grid3 {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .url-row {
    display: grid;
    grid-template-columns: 110px minmax(0, 1fr);
    gap: 10px;
    align-items: start;
  }
  .f {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .f > label,
  .sub {
    font-size: 12px;
    font-weight: 550;
    color: var(--text-muted);
  }
  .switch-cell {
    justify-content: center;
    min-height: var(--row-h);
  }
  .gap {
    gap: 18px;
    flex-wrap: wrap;
  }
  .hint {
    font-size: 12px;
    color: var(--text-faint);
  }
  code {
    font-family: var(--font-mono);
    font-size: 11.5px;
  }
  .code-wait {
    height: 130px;
    border-radius: var(--radius);
    border: 1px solid var(--border-strong);
    background: var(--bg-2);
  }
  .ref {
    font-size: 12px;
  }
  .ref summary {
    cursor: pointer;
    color: var(--text-muted);
    font-weight: 550;
  }
  dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 4px 14px;
    margin: 8px 0;
  }
  dt {
    color: var(--accent-text);
  }
  dd {
    margin: 0;
    color: var(--text-muted);
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
