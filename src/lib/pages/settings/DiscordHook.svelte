<script lang="ts">
  import { untrack } from 'svelte';
  import { api } from '$lib/api';
  import type { DiscordWebhook } from '$lib/bindings/DiscordWebhook';
  import type { SessionSummary } from '$lib/bindings/SessionSummary';
  import TemplateField from '$lib/editors/TemplateField.svelte';
  import { attempt, attemptOk } from '$lib/state/toast.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Segmented from '$lib/ui/Segmented.svelte';
  import Switch from '$lib/ui/Switch.svelte';
  import { Send, Trash2 } from '@lucide/svelte';
  import { END_TOKENS, LIVE_TOKENS, cleanMention, mentionKind, previewEnd, previewLive, webhookIssues, type ChannelInfo, type MentionKind } from './discord';

  interface Props {
    hook: DiscordWebhook;
    channel: ChannelInfo;
    summary: SessionSummary | null;
    onsaved: (h: DiscordWebhook) => void;
    ondelete: (id: string) => void;
  }

  let { hook, channel, summary, onsaved, ondelete }: Props = $props();

  // A copy to edit; saved with the button so the link and the rest go together.
  const start = untrack(() => structuredClone($state.snapshot(hook)));
  let draft = $state<DiscordWebhook>(start);
  let url = $state('');
  let kind = $state<MentionKind>(mentionKind(start.mention));
  let role = $state(mentionKind(start.mention) === 'role' ? start.mention : '');
  let saving = $state(false);
  let testing = $state(false);
  let confirmDelete = $state(false);
  const uid = `dh-${start.id}`;

  const mention = $derived(kind === 'none' ? '' : kind === 'everyone' ? '@everyone' : kind === 'here' ? '@here' : role);
  const current = $derived({ ...draft, mention });
  const issues = $derived(webhookIssues(current, url));
  const needsLink = $derived(!hook.has_url && !url.trim());
  const dirty = $derived(url.trim() !== '' || JSON.stringify(current) !== JSON.stringify({ ...hook }));
  const livePreview = $derived(previewLive(current, channel));
  const endPreview = $derived(summary ? previewEnd(current, summary, channel) : '');

  async function save(): Promise<boolean> {
    if (issues.length) return false;
    saving = true;
    const saved = await attempt(() => api.saveDiscordWebhook({ ...current, mention: cleanMention(mention) ?? '' }, url.trim() ? url.trim() : null));
    saving = false;
    if (!saved) return false;
    url = '';
    draft = structuredClone(saved);
    if (mentionKind(saved.mention) === 'role') role = saved.mention;
    onsaved(saved);
    return true;
  }

  async function test() {
    if (dirty && !(await save())) return;
    testing = true;
    await attemptOk(() => api.discordSendTest(hook.id), `Test sent to ${draft.name}`);
    testing = false;
  }
</script>

<article class="hook" data-webhook={hook.id} aria-label="Webhook {hook.name}">
  <div class="grid">
    <label class="f">
      <span class="label">Name</span>
      <input class="input" maxlength="80" bind:value={draft.name} placeholder="#announcements" />
    </label>
    <label class="f">
      <span class="label">Webhook link</span>
      <input
        class="input mono"
        type="password"
        autocomplete="off"
        spellcheck="false"
        bind:value={url}
        placeholder={hook.has_url ? 'Saved. Paste a new link to replace it' : 'https://discord.com/api/webhooks/…'}
      />
    </label>
  </div>

  <div class="switches">
    <Switch id="{uid}-live" label="Post when I go live" showLabel bind:checked={draft.on_live} />
    <Switch id="{uid}-end" label="Post a summary when the stream ends" showLabel bind:checked={draft.on_end} />
    <Switch id="{uid}-edit" label="Mark the go-live post as ended" showLabel bind:checked={draft.edit_on_end} />
  </div>

  <div class="mention">
    <span class="label">Ping</span>
    <Segmented
      label="Who gets pinged"
      bind:value={kind}
      options={[
        { value: 'none', label: 'Nobody' },
        { value: 'role', label: 'A role' },
        { value: 'here', label: '@here' },
        { value: 'everyone', label: '@everyone' }
      ]}
    />
    {#if kind === 'role'}
      <input class="input mono role" aria-label="Role mention" bind:value={role} placeholder={'<@&123456789012345678>'} />
    {/if}
  </div>
  {#if kind === 'role'}
    <p class="hint">In Discord, type <code>\@RoleName</code> in any channel and send it to get the mention. Only this role is pinged.</p>
  {/if}

  {#if draft.on_live}
    <TemplateField label="Go-live message" value={draft.live_template} tokens={LIVE_TOKENS} multiline onchange={(v) => (draft.live_template = v)} />
    <p class="preview selectable" data-testid="live-preview">{livePreview || 'Only the card with your title, category and preview.'}</p>
  {/if}
  {#if draft.on_end}
    <TemplateField label="End message" value={draft.end_template} tokens={END_TOKENS} multiline onchange={(v) => (draft.end_template = v)} />
    {#if endPreview}<p class="preview selectable" data-testid="end-preview">{endPreview}</p>{/if}
  {/if}

  {#each issues as i (i)}<p class="error" role="alert">{i}</p>{/each}
  {#if needsLink}<p class="hint">In Discord: Server Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL. Paste it above.</p>{/if}

  <footer>
    <Button size="sm" variant="primary" busy={saving} disabled={!dirty || needsLink || issues.length > 0} onclick={save}>Save</Button>
    <Button size="sm" busy={testing} disabled={needsLink || issues.length > 0} onclick={test}><Send size={14} />Send test</Button>
    <span class="grow"></span>
    {#if confirmDelete}
      <span class="faint small">Remove this webhook?</span>
      <Button size="sm" variant="danger" onclick={() => ondelete(hook.id)}>Remove</Button>
      <Button size="sm" variant="ghost" onclick={() => (confirmDelete = false)}>Keep</Button>
    {:else}
      <Button size="sm" variant="ghost" onclick={() => (confirmDelete = true)}><Trash2 size={14} />Remove</Button>
    {/if}
  </footer>
</article>

<style>
  .hook {
    max-width: 760px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-1);
  }
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
    gap: 10px;
  }
  .f {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
  }
  .switches {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 20px;
  }
  .mention {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }
  .role {
    width: 240px;
  }
  .hook :global(textarea) {
    min-height: 56px;
  }
  .preview {
    margin-top: -4px;
    padding: 8px 10px;
    border-radius: var(--radius);
    background: var(--bg-2);
    border-left: 3px solid #5865f2;
    font-size: 12.5px;
    white-space: pre-wrap;
  }
  .hint,
  .small {
    font-size: 12px;
    color: var(--text-faint);
  }
  .error {
    font-size: 12px;
    color: var(--danger);
  }
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .grow {
    flex: 1;
  }
</style>
