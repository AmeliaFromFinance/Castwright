<script lang="ts">
  import { count } from '$lib/format';
  import { statusText, totalText, type LiveInteract } from '$lib/overlay/interact';
  import { Trophy } from '@lucide/svelte';

  let { live, now }: { live: LiveInteract; now: number } = $props();

  const COLORS: Record<string, string> = { blue: '#387aff', pink: '#f5009b' };
</script>

<div class="results" data-status={live.status}>
  <p class="question">{live.title}</p>
  <ol class="bars">
    {#each live.choices as c, i (c.id)}
      {@const color = live.type === 'prediction' ? (COLORS[c.color] ?? (i === 0 ? COLORS.blue : COLORS.pink)) : 'var(--accent)'}
      <li class:winner={c.winner}>
        <div class="label">
          <span class="name truncate">{#if c.winner}<Trophy size={13} />{/if}{c.title}</span>
          <span class="num mono">
            {live.type === 'poll' ? count(c.amount) : `${count(c.amount)} pts`}{#if live.type === 'prediction'}<span class="faint">{` · ${count(c.users)} ${c.users === 1 ? 'viewer' : 'viewers'}`}</span>{/if}
            <b>{c.pct}%</b>
          </span>
        </div>
        <div class="track"><div class="fill" style:width="{c.pct}%" style:background={color}></div></div>
      </li>
    {/each}
  </ol>
  <p class="foot faint">
    <span>{statusText(live, now)}</span>
    <span>{totalText(live)}</span>
  </p>
</div>

<style>
  .results {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .question {
    font-size: 15px;
    font-weight: 650;
  }
  .bars {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .label {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 4px;
    font-size: 13px;
  }
  .name {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }
  .winner .name {
    font-weight: 650;
    color: var(--ok);
  }
  .num {
    font-size: 12px;
    white-space: nowrap;
  }
  .num b {
    margin-left: 6px;
  }
  .track {
    height: 10px;
    border-radius: 999px;
    background: var(--bg-3);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    border-radius: inherit;
    transition: width 0.6s var(--ease);
  }
  .foot {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
  }
</style>
