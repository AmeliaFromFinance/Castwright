<script lang="ts">
  import { tick } from 'svelte';
  import { api } from '$lib/api';
  import { errorMessage } from '$lib/api/backend';
  import type { ViewerCard } from '$lib/bindings/ViewerCard';
  import { twitchBadges } from '$lib/overlay/chat';
  import ChatBadges from '$lib/overlay/emotes/ChatBadges.svelte';
  import { app } from '$lib/state/app.svelte';
  import { Ban, Megaphone, ShieldOff, X } from '@lucide/svelte';
  import { mod } from './mod.svelte';
  import { TIMEOUTS, age, tierName } from './moderation';

  const open = $derived(mod.card);
  const user = $derived(open?.user ?? null);

  let box = $state<HTMLDivElement>();
  let pos = $state({ x: 0, y: 0 });
  let info = $state<ViewerCard | null>(null);
  let failed = $state('');
  let note = $state('');

  const recent = $derived(user ? app.chat.filter((c) => c.user?.id === user.id).slice(-8).reverse() : []);
  const last = $derived(recent[0]);
  const canMod = $derived(!!user && user.id !== app.twitch?.broadcaster?.id);
  const banned = $derived(!!user && (!!mod.banned[user.id] || (!!info?.banned && (info.banned_until === null || info.banned_until > Date.now()))));

  $effect(() => {
    const u = user;
    info = null;
    failed = '';
    if (!u) return;
    note = mod.notes[u.id] ?? '';
    let stale = false;
    api
      .twitchViewer(u.id)
      .then((v) => {
        if (!stale) info = v;
      })
      .catch((e) => {
        if (!stale) failed = errorMessage(e);
      });
    return () => (stale = true);
  });

  $effect(() => {
    if (!open) return;
    const p = { x: open.x, y: open.y };
    void tick().then(() => {
      const w = box?.offsetWidth ?? 320;
      const h = box?.offsetHeight ?? 400;
      pos = { x: Math.max(8, Math.min(p.x, window.innerWidth - w - 8)), y: Math.max(8, Math.min(p.y, window.innerHeight - h - 8)) };
      box?.focus();
    });
  });

  function close() {
    mod.card = null;
  }

  const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const date = (ts: number) => new Date(ts).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
</script>

<svelte:window
  onpointerdown={(e) => {
    if (open && box && !box.contains(e.target as Node) && !(e.target as Element).closest?.('dialog')) close();
  }}
/>

{#if open && user}
  <div
    bind:this={box}
    class="card"
    role="dialog"
    aria-label="Viewer card: {user.display_name}"
    tabindex="-1"
    style="left:{pos.x || open.x}px;top:{pos.y || open.y}px"
    onkeydown={(e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    }}
  >
    <header>
      {#if info?.profile_image_url}
        <img class="avatar" src={info.profile_image_url} alt="" width="40" height="40" />
      {:else}
        <span class="avatar blank" aria-hidden="true">{user.display_name.slice(0, 1).toUpperCase()}</span>
      {/if}
      <div class="who">
        <b>{user.display_name}</b>
        <span class="faint small">@{user.login}</span>
      </div>
      {#if last}<span class="badges"><ChatBadges twitch={twitchBadges(last)} size={16} /></span>{/if}
      <button type="button" class="x" aria-label="Close" onclick={close}><X size={15} /></button>
    </header>

    <dl class="facts">
      <dt>Account</dt>
      <dd>{info?.created_at ? `${age(info.created_at)} old · ${date(info.created_at)}` : failed ? '–' : '…'}</dd>
      <dt>Following</dt>
      <dd>{info ? (info.followed_at ? `${age(info.followed_at)} · ${date(info.followed_at)}` : 'Not following') : failed ? '–' : '…'}</dd>
      <dt>Sub</dt>
      <dd>{info ? (info.sub_tier ? `${tierName(info.sub_tier)}${info.sub_gifted ? ', gifted' : ''}` : 'Not subscribed') : failed ? '–' : '…'}</dd>
      {#if banned}
        <dt>Status</dt>
        <dd class="bad">{info?.banned_until && info.banned_until > Date.now() ? `Timed out until ${time(info.banned_until)}` : mod.banned[user.id] && !info?.banned ? 'Timed out or banned' : 'Banned'}</dd>
      {/if}
    </dl>
    {#if failed}<p class="err small">{failed}</p>{/if}

    {#if canMod}
      <div class="actions" role="group" aria-label="Mod actions">
        <span class="faint small">Time out</span>
        {#each TIMEOUTS as [s, label] (s)}
          <button type="button" class="chip" aria-label="Time out {label}" onclick={() => mod.timeout(user, s)}>{label}</button>
        {/each}
        <button type="button" class="chip" aria-label="Custom timeout" onclick={() => mod.ask('timeout', user)}>…</button>
        <span class="grow"></span>
        {#if mod.canShoutout}
          <button type="button" class="chip icon" aria-label="Shoutout" title="Shoutout" onclick={() => mod.shoutout(user)}><Megaphone size={13} /></button>
        {/if}
        {#if banned}
          <button type="button" class="chip" onclick={() => mod.unban(user)}><ShieldOff size={13} />Unban</button>
        {:else}
          <button type="button" class="chip danger" onclick={() => mod.ask('ban', user)}><Ban size={13} />Ban</button>
        {/if}
      </div>
    {/if}

    <section>
      <h4 class="eyebrow">This session</h4>
      {#if recent.length}
        <ol class="recent" aria-label="Recent messages">
          {#each recent as r (r.id)}
            <li class:deleted={r.data.deleted === true}><span class="faint mono">{time(r.ts)}</span> <span class="selectable">{r.message}</span></li>
          {/each}
        </ol>
      {:else}
        <p class="faint small">No messages yet.</p>
      {/if}
    </section>

    <section>
      <label class="eyebrow" for="mod-note">Mod note</label>
      <textarea
        id="mod-note"
        class="input"
        rows="2"
        placeholder="Only saved on this computer"
        bind:value={note}
        oninput={() => mod.setNote(user.id, note)}
      ></textarea>
    </section>
  </div>
{/if}

<style>
  .card {
    position: fixed;
    z-index: 90;
    width: 350px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-1);
    box-shadow: var(--shadow-pop);
    font-size: 12.5px;
    outline: none;
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    flex: none;
  }
  .blank {
    display: grid;
    place-items: center;
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 700;
    font-size: 16px;
  }
  .who {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .who b {
    font-size: 14px;
  }
  .badges {
    display: inline-flex;
    gap: 3px;
    margin-left: auto;
  }
  .x {
    border: 0;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    padding: 4px;
    border-radius: 6px;
    margin-left: 4px;
  }
  .badges:empty + .x {
    margin-left: auto;
  }
  .x:hover {
    background: var(--bg-3);
  }
  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 12px;
    margin: 0;
  }
  dt {
    color: var(--text-muted);
  }
  dd {
    margin: 0;
  }
  .small {
    font-size: 11.5px;
  }
  .bad,
  .err {
    color: var(--danger);
  }
  .err {
    margin: 0;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 0;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }
  .actions .faint {
    margin-right: 2px;
    white-space: nowrap;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--border);
    background: var(--bg-2);
    color: var(--text);
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 600;
    padding: 3px 7px;
    cursor: pointer;
  }
  .chip:hover {
    background: var(--bg-3);
  }
  .chip.danger {
    color: var(--danger);
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  h4 {
    margin: 0;
  }
  .recent {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 120px;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 3px;
    overflow-wrap: anywhere;
  }
  .recent .mono {
    font-size: 11px;
  }
  .deleted .selectable {
    text-decoration: line-through;
    color: var(--text-faint);
  }
  textarea {
    resize: vertical;
    min-height: 44px;
    font: inherit;
  }
</style>
