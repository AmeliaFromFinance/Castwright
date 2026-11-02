<script lang="ts">
  import type { Role, ShownBadge } from '../chat';
  import type { SevenTvBadge } from './cosmetics';

  interface Props {
    twitch: ShownBadge[];
    seventv?: SevenTvBadge | null;
    /** Badge height in pixels. */
    size: number;
  }
  let { twitch, seventv = null, size }: Props = $props();

  const ROLE: Record<Role, { title: string; bg: string; path: string }> = {
    broadcaster: { title: 'Broadcaster', bg: '#e91916', path: 'M3 5.5h7.5v7H3zM11.5 8l3.5-2v6l-3.5-2z' },
    moderator: { title: 'Moderator', bg: '#00ad03', path: 'M12.6 2.5l.9.9-6.4 6.4 1.2 1.2-1.1 1.1-1.2-1.2-1.8 1.8a1 1 0 01-1.4-1.4l1.8-1.8-1.2-1.2L4.5 7.6l1.2 1.2z' },
    vip: { title: 'VIP', bg: '#e005b9', path: 'M4.5 3.5h7l2.5 3.2L8 13.5 2 6.7z' },
    subscriber: { title: 'Subscriber', bg: '#8205b4', path: 'M8 2.2l1.75 3.6 3.95.55-2.87 2.77.69 3.93L8 11.2l-3.52 1.85.69-3.93L2.3 6.35l3.95-.55z' }
  };

  const srcset = (images: { url: string; width: number }[]) => images.map((i) => `${i.url} ${i.width}w`).join(', ');
</script>

{#each twitch as b, i (i)}{#if b.kind === 'image'}<img
      class="cw-chat-badge cw-badge-twitch"
      src={b.images[0]?.url}
      srcset={srcset(b.images)}
      sizes="{size}px"
      width={size}
      height={size}
      alt={b.title}
      title={b.title}
      draggable="false"
    />{:else}<svg class="cw-chat-badge cw-badge-role" width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={ROLE[b.role].title}>
      <rect width="16" height="16" rx="3.5" fill={ROLE[b.role].bg} />
      <path d={ROLE[b.role].path} fill="#fff" />
    </svg>{/if}{/each}{#if seventv}<img
    class="cw-chat-badge cw-badge-7tv"
    src={seventv.images[0]?.url}
    srcset={srcset(seventv.images)}
    sizes="{size}px"
    width={size}
    height={size}
    alt={seventv.name}
    title={seventv.name}
    draggable="false"
  />{/if}

<style>
  .cw-chat-badge {
    display: inline-block;
    vertical-align: -0.12em;
    margin-right: 0.25em;
  }
  .cw-badge-role {
    filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.3));
  }
</style>
