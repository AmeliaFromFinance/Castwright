<script lang="ts">
  import type { LayerKind } from '$lib/bindings/LayerKind';
  import type { TextStyle } from '$lib/bindings/TextStyle';
  import { CREDIT_TITLES } from '$lib/overlay/credits';
  import Button from '$lib/ui/Button.svelte';
  import Collapse from '$lib/ui/Collapse.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import Segmented from '$lib/ui/Segmented.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import { ArrowDown, ArrowUp, Play } from '@lucide/svelte';
  import NumberInput from '../ui/NumberInput.svelte';
  import Prop from '../ui/Prop.svelte';
  import TextStyleEditor from './TextStyleEditor.svelte';

  type CreditsKind = Extract<LayerKind, { type: 'credits' }>;

  interface Props {
    kind: CreditsKind;
    uid: string;
    set: (fn: (k: CreditsKind) => void, key: string) => void;
    onroll: () => void;
  }

  let { kind, uid, set, onroll }: Props = $props();

  function move(i: number, d: number) {
    set((x) => {
      const j = i + d;
      if (j < 0 || j >= x.sections.length) return;
      const [s] = x.sections.splice(i, 1);
      x.sections.splice(j, 0, s!);
    }, `sections:move`);
  }

  const styleSet = (field: 'style' | 'title_style' | 'heading_style') => (fn: (s: TextStyle) => void, key: string) =>
    set((x) => fn(x[field]), `${field}:${key}`);
</script>

<Prop label="Roll" hint="Plays the roll on the canvas from the top.">
  <Button size="sm" onclick={onroll}><Play size={13} />Roll now</Button>
</Prop>

<Prop label="Starts">
  <Segmented
    label="When the roll starts"
    value={kind.start}
    options={[
      { value: 'on_load', label: 'When shown' },
      { value: 'trigger', label: 'From an action' }
    ]}
    onchange={(v) => set((x) => (x.start = v), 'start')}
  />
</Prop>
{#if kind.start === 'trigger'}<p class="hint">Use the Roll credits step in an action. The layer stays empty until then.</p>{/if}

<Prop label="Speed" hint="Scroll speed. Or set a length to fit one pass into that many seconds.">
  <div class="pair">
    <NumberInput label="Scroll speed" unit="px/s" min={5} max={1000} value={kind.speed} disabled={kind.fit_s > 0} oninput={(v) => set((x) => (x.speed = Math.round(v)), 'speed')} />
    <NumberInput label="Fit to seconds (0 = off)" unit="s" min={0} max={3600} value={kind.fit_s} oninput={(v) => set((x) => (x.fit_s = Math.round(v)), 'fit')} />
  </div>
</Prop>

<Prop label="At the end">
  <Segmented
    label="At the end"
    value={kind.repeat ? 'loop' : 'stop'}
    options={[
      { value: 'stop', label: 'Stop' },
      { value: 'loop', label: 'Loop' }
    ]}
    onchange={(v) => set((x) => (x.repeat = v === 'loop'), 'repeat')}
  />
</Prop>

<Prop label="Heading" for="{uid}-cr-head" stacked hint={'Above the names. Live values work, e.g. {{session.follows}}.'}>
  <input id="{uid}-cr-head" class="input" value={kind.heading} oninput={(e) => {
    const v = e.currentTarget.value;
    set((x) => (x.heading = v), 'heading');
  }} />
</Prop>
<Prop label="Footer" for="{uid}-cr-foot" stacked>
  <input id="{uid}-cr-foot" class="input" value={kind.footer} oninput={(e) => {
    const v = e.currentTarget.value;
    set((x) => (x.footer = v), 'footer');
  }} />
</Prop>

<Prop label="Sections" stacked hint="Empty sections are skipped. Leave a title blank to hide it.">
  <ul class="sections" aria-label="Credits sections">
    {#each kind.sections as s, i (s.kind)}
      <li class:off={!s.on}>
        <Switch label="Show {CREDIT_TITLES[s.kind]}" checked={s.on} onchange={(v) => set((x) => (x.sections[i]!.on = v), `on:${s.kind}`)} />
        <input
          class="input sm"
          aria-label="Title for {CREDIT_TITLES[s.kind]}"
          placeholder={CREDIT_TITLES[s.kind]}
          value={s.title}
          oninput={(e) => {
            const v = e.currentTarget.value;
            set((x) => (x.sections[i]!.title = v), `title:${s.kind}`);
          }}
        />
        <IconButton size="sm" label="Move {CREDIT_TITLES[s.kind]} up" disabled={i === 0} onclick={() => move(i, -1)}><ArrowUp /></IconButton>
        <IconButton size="sm" label="Move {CREDIT_TITLES[s.kind]} down" disabled={i === kind.sections.length - 1} onclick={() => move(i, 1)}><ArrowDown /></IconButton>
      </li>
    {/each}
  </ul>
</Prop>

<Prop label="Top chatters">
  <NumberInput label="Most top chatters" min={1} max={25} value={kind.max_chatters} oninput={(v) => set((x) => (x.max_chatters = Math.round(v)), 'chatters')} />
</Prop>
<Prop label="Amounts" hint="Months, gifts, bits, viewers and messages.">
  <Switch label="Show amounts" checked={kind.show_amounts} onchange={(v) => set((x) => (x.show_amounts = v), 'amounts')} />
</Prop>
<Prop label="Names">
  <Segmented
    label="Name style"
    value={kind.names}
    options={[
      { value: 'plain', label: 'Plain' },
      { value: 'chat', label: 'Like chat' }
    ]}
    onchange={(v) => set((x) => (x.names = v), 'names')}
  />
</Prop>
{#if kind.names === 'chat'}<p class="hint">Chat colours and badges for people who chatted recently, and 7TV paints.</p>{/if}
<Prop label="Columns">
  <Segmented
    label="Columns"
    value={kind.columns === 2 ? '2' : '1'}
    options={[
      { value: '1', label: '1' },
      { value: '2', label: '2' }
    ]}
    onchange={(v) => set((x) => (x.columns = Number(v)), 'columns')}
  />
</Prop>
<Prop label="Fade edges">
  <Switch label="Fade at the top and bottom" checked={kind.fade_edges} onchange={(v) => set((x) => (x.fade_edges = v), 'fade')} />
</Prop>
<Prop label="Page time" hint="With reduced motion the names show as pages instead of scrolling.">
  <NumberInput label="Seconds per page" unit="s" min={2} max={60} value={kind.page_s} oninput={(v) => set((x) => (x.page_s = Math.round(v)), 'page')} />
</Prop>
<p class="hint">The editor shows names from the current or last stream, or sample names if there are none yet.</p>

<Collapse id="insp.credits.names" title="Name text">
  <div class="text-group"><TextStyleEditor style={kind.style} uid="{uid}-cn" set={styleSet('style')} /></div>
</Collapse>
<Collapse id="insp.credits.titles" title="Section titles" open={false}>
  <div class="text-group"><TextStyleEditor style={kind.title_style} uid="{uid}-ct" set={styleSet('title_style')} /></div>
</Collapse>
<Collapse id="insp.credits.heading" title="Heading and footer" open={false}>
  <div class="text-group"><TextStyleEditor style={kind.heading_style} uid="{uid}-ch" set={styleSet('heading_style')} /></div>
</Collapse>

<style>
  .pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 6px;
  }
  .hint {
    font-size: 11.5px;
    color: var(--text-faint);
  }
  .sections {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .sections li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sections .input {
    flex: 1;
    min-width: 0;
  }
  .sections li.off .input {
    opacity: 0.55;
  }
  .input.sm {
    height: 28px;
    padding: 0 8px;
    font-size: 12.5px;
  }
  .text-group {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 2px 0 6px;
  }
</style>
