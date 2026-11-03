<script lang="ts">
  import type { Permission } from '$lib/bindings/Permission';
  import type { Soundboard } from '$lib/bindings/Soundboard';
  import RewardPicker from '$lib/pages/automation/RewardPicker.svelte';
  import { defaultSoundboard, removePage, renamePage } from '$lib/soundboard/board';
  import { app } from '$lib/state/app.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import IconButton from '$lib/ui/IconButton.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import { Plus, Trash2 } from '@lucide/svelte';

  interface Props {
    open: boolean;
    board: Soundboard;
    onsave: (b: Soundboard) => void;
  }

  let { open = $bindable(), board, onsave }: Props = $props();

  let draft = $state<Soundboard>(defaultSoundboard());
  let newPage = $state('');
  $effect(() => {
    if (open) {
      draft = structuredClone($state.snapshot(board));
      newPage = '';
    }
  });

  const signedIn = $derived(!!app.twitch?.broadcaster);
  const PERMISSIONS: Array<[Permission, string]> = [
    ['everyone', 'Everyone'],
    ['subscriber', 'Subscribers and up'],
    ['vip', 'VIPs and up'],
    ['moderator', 'Moderators and the streamer']
  ];

  const int = (v: string, max: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0;
  };

  function addPage() {
    const name = newPage.trim();
    if (!name || draft.groups.includes(name)) return;
    draft.groups = [...draft.groups, name];
    newPage = '';
  }
</script>

<Dialog bind:open title="Soundboard settings" width={560}>
  <div class="form">
    <section>
      <h3>Cooldown</h3>
      <div class="f narrow">
        <label for="sb-global">Between any two sounds (s)</label>
        <input id="sb-global" class="input" type="number" min="0" max="86400" value={draft.global_cooldown_s} oninput={(e) => (draft.global_cooldown_s = int(e.currentTarget.value, 86_400))} />
        <p class="hint">0 = off. Each sound also has its own cooldown.</p>
      </div>
    </section>

    <section>
      <h3>Pages</h3>
      <ul class="pages">
        <li><span class="faint">Main</span><span class="hint">Always there</span></li>
        {#each draft.groups as g, i (g)}
          <li>
            <input
              class="input"
              aria-label="Page name"
              value={g}
              onchange={(e) => {
                const next = renamePage(draft, g, e.currentTarget.value);
                if (next === draft) e.currentTarget.value = g;
                else draft = next;
              }}
            />
            <IconButton size="sm" tone="danger" label="Remove page {g}" onclick={() => (draft = removePage(draft, draft.groups[i]!))}><Trash2 /></IconButton>
          </li>
        {/each}
      </ul>
      <form
        class="add"
        onsubmit={(e) => {
          e.preventDefault();
          addPage();
        }}
      >
        <input class="input" aria-label="New page name" placeholder="New page" maxlength="30" bind:value={newPage} />
        <Button size="sm" type="submit" disabled={!newPage.trim()}><Plus size={14} />Add page</Button>
      </form>
      <p class="hint">Sounds on a removed page move to Main.</p>
    </section>

    <section>
      <h3>Sound requests</h3>
      {#if signedIn}
        <div class="f">
          <label for="sb-request">Reward</label>
          <RewardPicker
            id="sb-request"
            rewardId={draft.request_reward_id}
            rewardTitle={draft.request_reward_title}
            onlyMine
            onchange={(id, title) => {
              draft.request_reward_id = id;
              draft.request_reward_title = title;
            }}
          />
          <p class="hint">Make a reward that asks for a message. Viewers type a sound name and the closest match plays. No match, cooldown or mute: the points go back.</p>
        </div>
      {:else}
        <p class="hint">Sign in to Twitch to use a reward for sound requests.</p>
      {/if}
    </section>

    <section>
      <h3>Chat command</h3>
      <div class="row">
        <Switch label="Let chat play sounds" showLabel checked={draft.command.enabled} onchange={(v) => (draft.command.enabled = v)} />
      </div>
      {#if draft.command.enabled}
        <div class="grid3">
          <div class="f">
            <label for="sb-cmd">Command</label>
            <div class="prefix">
              <span class="mono faint">!</span>
              <input id="sb-cmd" class="input mono" spellcheck="false" bind:value={draft.command.name} />
            </div>
          </div>
          <div class="f">
            <label for="sb-perm">Who can use it</label>
            <select id="sb-perm" class="input" bind:value={draft.command.permission}>
              {#each PERMISSIONS as [value, text] (value)}<option {value}>{text}</option>{/each}
            </select>
          </div>
          <div class="f">
            <label for="sb-ucd">Per-viewer cooldown (s)</label>
            <input id="sb-ucd" class="input" type="number" min="0" value={draft.command.cooldown_s} oninput={(e) => (draft.command.cooldown_s = int(e.currentTarget.value, 86_400))} />
          </div>
        </div>
        <p class="hint">
          <code>!{draft.command.name.replace(/^!+/, '') || 'sound'} airhorn</code> plays the closest match. Moderators skip the per-viewer cooldown. Sound cooldowns still apply.
        </p>
      {/if}
    </section>
  </div>

  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" onclick={() => onsave(draft)}>Save</Button>
  {/snippet}
</Dialog>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  h3 {
    font-size: 13px;
  }
  .f {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .narrow {
    max-width: 260px;
  }
  label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
  }
  .hint {
    font-size: 12px;
    color: var(--text-faint);
  }
  .pages {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .pages li,
  .add {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .pages li > span:first-child {
    flex: 1;
    padding-left: 10px;
    font-size: 13px;
  }
  .pages input,
  .add input {
    flex: 1;
  }
  .grid3 {
    display: grid;
    grid-template-columns: 1fr 1.3fr 1fr;
    gap: 12px;
  }
  .prefix {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .prefix input {
    flex: 1;
    min-width: 0;
  }
</style>
