<script lang="ts">
  import type { EventKind } from '$lib/bindings/EventKind';
  import type { Layer } from '$lib/bindings/Layer';
  import type { LayerKind } from '$lib/bindings/LayerKind';
  import type { TextStyle } from '$lib/bindings/TextStyle';
  import type { TimerMode } from '$lib/bindings/TimerMode';
  import { KIND_LABELS } from '$lib/format';
  import { ALERTABLE_KINDS } from '$lib/overlay/labels';
  import Button from '$lib/ui/Button.svelte';
  import Collapse from '$lib/ui/Collapse.svelte';
  import ColorInput from '$lib/ui/ColorInput.svelte';
  import Segmented from '$lib/ui/Segmented.svelte';
  import Slider from '$lib/ui/Slider.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import AssetPicker from '$lib/widgets/AssetPicker.svelte';
  import { BellRing } from '@lucide/svelte';
  import NumberInput from '../ui/NumberInput.svelte';
  import Prop from '../ui/Prop.svelte';
  import CustomWidgetEditor from './CustomWidgetEditor.svelte';
  import TextStyleEditor from './TextStyleEditor.svelte';

  interface Props {
    layer: Layer;
    uid: string;
    /** Variable names for suggestions. */
    varNames: string[];
    wide: boolean;
    set: (fn: (k: LayerKind) => void, key: string) => void;
    ontestalert: () => void;
    ontogglewide: () => void;
  }

  let { layer, uid, varNames, wide, set, ontestalert, ontogglewide }: Props = $props();

  const k = $derived(layer.kind);
  const fit = [
    { value: 'contain' as const, label: 'Fit' },
    { value: 'cover' as const, label: 'Fill' },
    { value: 'fill' as const, label: 'Stretch' }
  ];
  const TIMER_MODES: Array<{ value: TimerMode; label: string }> = [
    { value: 'countdown', label: 'Countdown' },
    { value: 'stopwatch', label: 'Stopwatch' },
    { value: 'clock', label: 'Clock' },
    { value: 'uptime', label: 'Stream uptime' }
  ];
  const LIST_KINDS = ALERTABLE_KINDS.filter((x) => x !== 'custom');

  function styleSet(fn: (s: TextStyle) => void, key: string) {
    set((x) => {
      if ('style' in x) fn(x.style);
    }, `style:${key}`);
  }

  function toggleKind(kind: EventKind) {
    set((x) => {
      if (x.type !== 'event_list') return;
      if (x.kinds.length === 0) x.kinds = LIST_KINDS.filter((c) => c !== kind);
      else x.kinds = x.kinds.includes(kind) ? x.kinds.filter((c) => c !== kind) : [...x.kinds, kind];
    }, 'kinds');
  }

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
</script>

{#snippet textGroup(style: TextStyle)}
  <Collapse id="insp.text" title="Text style">
    <div class="text-group"><TextStyleEditor {style} {uid} set={styleSet} /></div>
  </Collapse>
{/snippet}

<datalist id="{uid}-vars">
  {#each varNames as v (v)}<option value={v}></option>{/each}
</datalist>

{#if k.type === 'text'}
  <Prop label="Text" for="{uid}-text" stacked hint={'Insert live values with {{name}}, e.g. {{last.follow.name}}.'}>
    <textarea
      id="{uid}-text"
      class="input"
      rows="3"
      value={k.text}
      oninput={(e) => {
        const v = e.currentTarget.value;
        set((x) => x.type === 'text' && (x.text = v), 'text');
      }}
    ></textarea>
  </Prop>
  {@render textGroup(k.style)}
{:else if k.type === 'shape'}
  <Prop label="Shape">
    <Segmented
      label="Shape"
      value={k.shape}
      options={[
        { value: 'rect', label: 'Rectangle' },
        { value: 'ellipse', label: 'Ellipse' },
        { value: 'line', label: 'Line' }
      ]}
      onchange={(v) => set((x) => x.type === 'shape' && (x.shape = v), 'shape')}
    />
  </Prop>
  <Prop label="Fill">
    <ColorInput label="Fill colour" value={k.fill} onchange={(v) => set((x) => x.type === 'shape' && (x.fill = v), 'fill')} />
  </Prop>
  <Prop label="Stroke">
    <div class="pair">
      <NumberInput label="Stroke width" unit="px" min={0} max={200} value={k.stroke_width} oninput={(v) => set((x) => x.type === 'shape' && (x.stroke_width = v), 'sw')} />
      <ColorInput label="Stroke colour" value={k.stroke} onchange={(v) => set((x) => x.type === 'shape' && (x.stroke = v), 'stroke')} />
    </div>
  </Prop>
  {#if k.shape === 'rect'}<p class="hint">Round the corners with Corner radius under Style.</p>{/if}
{:else if k.type === 'image'}
  <Prop label="Image">
    <AssetPicker label="Image" kind="image" value={k.src} onchange={(v) => set((x) => x.type === 'image' && (x.src = v), 'src')} />
  </Prop>
  <Prop label="Sizing">
    <Segmented label="Image sizing" value={k.fit} options={fit} onchange={(v) => set((x) => x.type === 'image' && (x.fit = v), 'fit')} />
  </Prop>
{:else if k.type === 'video'}
  <Prop label="Video">
    <AssetPicker label="Video" kind="video" value={k.src} onchange={(v) => set((x) => x.type === 'video' && (x.src = v), 'src')} />
  </Prop>
  <Prop label="Sizing">
    <Segmented label="Video sizing" value={k.fit} options={fit} onchange={(v) => set((x) => x.type === 'video' && (x.fit = v), 'fit')} />
  </Prop>
  <Prop label="Loop">
    <Switch label="Loop video" checked={k.looped} onchange={(v) => set((x) => x.type === 'video' && (x.looped = v), 'loop')} />
  </Prop>
  <Prop label="Muted">
    <Switch label="Mute video" checked={k.muted} onchange={(v) => set((x) => x.type === 'video' && (x.muted = v), 'muted')} />
  </Prop>
  <Prop label="Volume">
    <Slider
      label="Video volume"
      min={0}
      max={100}
      value={k.volume}
      disabled={k.muted}
      format={(v) => `${v}%`}
      oninput={(v) => set((x) => x.type === 'video' && (x.volume = v), 'volume')}
    />
  </Prop>
{:else if k.type === 'alerts'}
  <div class="note">
    <BellRing size={16} />
    <p>Alerts from the Alerts page play inside this box. Size it to fit your alert designs.</p>
  </div>
  <Button size="sm" onclick={ontestalert}>Play a test alert</Button>
{:else if k.type === 'chat'}
  <Prop label="Messages">
    <div class="pair">
      <NumberInput label="Maximum messages" prefix="Max" min={1} max={100} value={k.max_messages} oninput={(v) => set((x) => x.type === 'chat' && (x.max_messages = Math.round(v)), 'max')} />
      <NumberInput label="Fade after seconds (0 keeps them)" prefix="Fade" unit="s" min={0} max={3600} value={k.fade_after_s} oninput={(v) => set((x) => x.type === 'chat' && (x.fade_after_s = Math.round(v)), 'fade')} />
    </div>
  </Prop>
  <Prop label="Twitch badges">
    <Switch label="Show Twitch badges" checked={k.show_badges} onchange={(v) => set((x) => x.type === 'chat' && (x.show_badges = v), 'badges')} />
  </Prop>
  <Prop label="7TV badges">
    <Switch label="Show 7TV badges" checked={k.seventv_badges !== false} onchange={(v) => set((x) => x.type === 'chat' && (x.seventv_badges = v), '7tvbadges')} />
  </Prop>
  <Prop label="Name paints" hint="From 7TV.">
    <Switch label="Show 7TV name paints" checked={k.seventv_paints !== false} onchange={(v) => set((x) => x.type === 'chat' && (x.seventv_paints = v), 'paints')} />
  </Prop>
  <Prop label="Emotes" hint="Twitch emotes always show.">
    <div class="switches">
      <Switch label="7TV" showLabel checked={k.seventv_emotes !== false} onchange={(v) => set((x) => x.type === 'chat' && (x.seventv_emotes = v), '7tv')} />
      <Switch label="BetterTTV" showLabel checked={k.bttv_emotes !== false} onchange={(v) => set((x) => x.type === 'chat' && (x.bttv_emotes = v), 'bttv')} />
      <Switch label="FrankerFaceZ" showLabel checked={k.ffz_emotes !== false} onchange={(v) => set((x) => x.type === 'chat' && (x.ffz_emotes = v), 'ffz')} />
    </div>
  </Prop>
  <Prop label="Hide !commands">
    <Switch label="Hide commands" checked={k.hide_commands} onchange={(v) => set((x) => x.type === 'chat' && (x.hide_commands = v), 'cmds')} />
  </Prop>
  <Prop label="Newest on top">
    <Switch label="Newest on top" checked={k.newest_on_top} onchange={(v) => set((x) => x.type === 'chat' && (x.newest_on_top = v), 'top')} />
  </Prop>
  <Prop label="Hide users" for="{uid}-hide" hint="Names separated by commas, e.g. bots.">
    <input
      id="{uid}-hide"
      class="input"
      placeholder="nightbot, streamelements"
      value={k.hide_users.join(', ')}
      onchange={(e) => {
        const list = e.currentTarget.value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        set((x) => {
          if (x.type === 'chat') x.hide_users = list;
        }, 'hide');
      }}
    />
  </Prop>
  {@render textGroup(k.style)}
{:else if k.type === 'goal'}
  <Prop label="Title" for="{uid}-title">
    <input id="{uid}-title" class="input" value={k.title} oninput={(e) => {
      const v = e.currentTarget.value;
      set((x) => x.type === 'goal' && (x.title = v), 'title');
    }} />
  </Prop>
  <Prop label="Progress from" for="{uid}-var" hint="Variable with the current amount.">
    <input id="{uid}-var" class="input mono" list="{uid}-vars" spellcheck="false" value={k.current_var} oninput={(e) => {
      const v = e.currentTarget.value.trim();
      set((x) => x.type === 'goal' && (x.current_var = v), 'var');
    }} />
  </Prop>
  <Prop label="Target">
    <NumberInput label="Goal target" min={0} value={k.target} oninput={(v) => set((x) => x.type === 'goal' && (x.target = v), 'target')} />
  </Prop>
  <Prop label="Bar">
    <ColorInput label="Bar colour" value={k.bar_color} onchange={(v) => set((x) => x.type === 'goal' && (x.bar_color = v), 'bar')} />
  </Prop>
  <Prop label="Track">
    <ColorInput label="Track colour" value={k.track_color} onchange={(v) => set((x) => x.type === 'goal' && (x.track_color = v), 'track')} />
  </Prop>
  <Prop label="Numbers">
    <Switch label="Show numbers" checked={k.show_numbers} onchange={(v) => set((x) => x.type === 'goal' && (x.show_numbers = v), 'nums')} />
  </Prop>
  {@render textGroup(k.style)}
{:else if k.type === 'counter'}
  <Prop label="Value from" for="{uid}-var" hint="Variable to show, e.g. counter.deaths.">
    <input id="{uid}-var" class="input mono" list="{uid}-vars" spellcheck="false" value={k.var} oninput={(e) => {
      const v = e.currentTarget.value.trim();
      set((x) => x.type === 'counter' && (x.var = v), 'var');
    }} />
  </Prop>
  <Prop label="Format" for="{uid}-format" hint={'{{value}} is replaced by the number.'}>
    <input id="{uid}-format" class="input" placeholder={'{{value}}'} value={k.format} oninput={(e) => {
      const v = e.currentTarget.value;
      set((x) => x.type === 'counter' && (x.format = v), 'format');
    }} />
  </Prop>
  {@render textGroup(k.style)}
{:else if k.type === 'timer'}
  <Prop label="Mode" for="{uid}-mode">
    <select id="{uid}-mode" class="input" value={k.mode} onchange={(e) => {
      const v = e.currentTarget.value as TimerMode;
      set((x) => x.type === 'timer' && (x.mode = v), 'mode');
    }}>
      {#each TIMER_MODES as m (m.value)}<option value={m.value}>{m.label}</option>{/each}
    </select>
  </Prop>
  {#if k.mode === 'countdown'}
    <Prop label="Length" hint="{mmss(k.duration_s)} (minutes:seconds)">
      <NumberInput label="Countdown length in seconds" unit="s" min={0} max={86400} value={k.duration_s} oninput={(v) => set((x) => x.type === 'timer' && (x.duration_s = Math.round(v)), 'dur')} />
    </Prop>
  {/if}
  {#if k.mode === 'countdown' || k.mode === 'stopwatch'}
    <Prop label="Start from" for="{uid}-anchor" hint="Optional variable with a start or end time.">
      <input id="{uid}-anchor" class="input mono" list="{uid}-vars" spellcheck="false" placeholder="When the overlay loads" value={k.anchor_var} oninput={(e) => {
        const v = e.currentTarget.value.trim();
        set((x) => x.type === 'timer' && (x.anchor_var = v), 'anchor');
      }} />
    </Prop>
  {/if}
  <Prop label="Label before" for="{uid}-prefix">
    <input id="{uid}-prefix" class="input" placeholder="e.g. Back in " value={k.prefix} oninput={(e) => {
      const v = e.currentTarget.value;
      set((x) => x.type === 'timer' && (x.prefix = v), 'prefix');
    }} />
  </Prop>
  {@render textGroup(k.style)}
{:else if k.type === 'event_list'}
  <Prop label="Show" stacked>
    <div class="chips" role="group" aria-label="Event kinds to show">
      {#each LIST_KINDS as kind (kind)}
        <button type="button" class="chip" aria-pressed={k.kinds.length === 0 || k.kinds.includes(kind)} onclick={() => toggleKind(kind)}>
          {KIND_LABELS[kind]}
        </button>
      {/each}
    </div>
    {#if k.kinds.length === 0}<p class="hint">Nothing picked shows every kind.</p>{/if}
  </Prop>
  <Prop label="Layout">
    <Segmented
      label="List layout"
      value={k.direction}
      options={[
        { value: 'vertical', label: 'List' },
        { value: 'ticker', label: 'Ticker' }
      ]}
      onchange={(v) => set((x) => x.type === 'event_list' && (x.direction = v), 'dir')}
    />
  </Prop>
  <Prop label="Items">
    <NumberInput label="Maximum items" min={1} max={50} value={k.max_items} oninput={(v) => set((x) => x.type === 'event_list' && (x.max_items = Math.round(v)), 'max')} />
  </Prop>
  <Prop label="Item text" for="{uid}-item" hint={'e.g. {{name}} · {{label}}. Leave empty for the default.'}>
    <input id="{uid}-item" class="input" value={k.item_format} oninput={(e) => {
      const v = e.currentTarget.value;
      set((x) => x.type === 'event_list' && (x.item_format = v), 'item');
    }} />
  </Prop>
  {@render textGroup(k.style)}
{:else if k.type === 'custom'}
  <CustomWidgetEditor kind={k} {uid} {wide} {ontogglewide} set={(fn, key) => set((x) => x.type === 'custom' && fn(x), key)} />
{/if}

<style>
  .switches {
    display: grid;
    gap: 2px;
  }
  .pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 6px;
  }
  .hint {
    font-size: 11.5px;
    color: var(--text-faint);
  }
  .text-group {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 2px 0 6px;
  }
  .note {
    display: flex;
    gap: 10px;
    padding: 10px 12px;
    border-radius: var(--radius);
    background: var(--bg-2);
    color: var(--text-muted);
    font-size: 12.5px;
  }
  .note :global(svg) {
    flex: none;
    margin-top: 1px;
    color: var(--accent-text);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    height: 24px;
    padding: 0 9px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    font-size: 11.5px;
    cursor: pointer;
  }
  .chip:hover {
    border-color: var(--border-strong);
    color: var(--text);
  }
  .chip[aria-pressed='true'] {
    background: var(--accent-soft);
    border-color: transparent;
    color: var(--accent-text);
  }
</style>
