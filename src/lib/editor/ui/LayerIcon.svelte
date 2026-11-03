<script lang="ts">
  import { BellRing, ChartColumn, Clapperboard, Code, Film, Hash, Image, ListOrdered, Megaphone, MessageSquare, Music, Square, Target, Ticket, Timer, TrainFront, Type, Users } from '@lucide/svelte';
  import type { LayerType } from '../layers';

  let { type, size = 15 }: { type: LayerType; size?: number } = $props();

  const icons = {
    text: Type,
    shape: Square,
    image: Image,
    video: Film,
    alerts: BellRing,
    chat: MessageSquare,
    goal: Target,
    counter: Hash,
    timer: Timer,
    event_list: ListOrdered,
    poll: ChartColumn,
    credits: Clapperboard,
    ad_break: Megaphone,
    now_playing: Music,
    hype_train: TrainFront,
    giveaway: Ticket,
    queue: Users,
    custom: Code
  } as const;

  const Icon = $derived(icons[type] ?? Square);
</script>

<Icon {size} strokeWidth={1.8} aria-hidden="true" />
