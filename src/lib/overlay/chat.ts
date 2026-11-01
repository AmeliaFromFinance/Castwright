import type { Event } from '$lib/bindings/Event';
import type { MessagePart } from '$lib/bindings/MessagePart';

export interface ChatFilter {
  maxMessages: number;
  hideCommands: boolean;
  hideUsers: readonly string[];
  /** Seconds before a message disappears (0 = never). */
  fadeAfterS: number;
  now: number;
}

export function normLogin(s: string): string {
  return s.trim().replace(/^@/, '').toLowerCase();
}

export function isCommand(e: Event): boolean {
  return (e.message ?? '').trimStart().startsWith('!');
}

/** Which chat messages a chat layer shows, oldest first. */
export function visibleChat(chat: readonly Event[], f: ChatFilter): Event[] {
  const hidden = new Set(f.hideUsers.map(normLogin).filter(Boolean));
  const max = Math.max(1, Math.floor(f.maxMessages) || 1);
  const cutoff = f.fadeAfterS > 0 ? f.now - f.fadeAfterS * 1000 : -Infinity;
  const out: Event[] = [];
  for (let i = chat.length - 1; i >= 0 && out.length < max; i--) {
    const e = chat[i];
    if (!e || e.kind !== 'chat') continue;
    if (e.ts < cutoff) continue;
    if (f.hideCommands && isCommand(e)) continue;
    const login = normLogin(e.user?.login ?? '');
    const display = normLogin(e.user?.display_name ?? '');
    if (hidden.size && (hidden.has(login) || hidden.has(display))) continue;
    out.push(e);
  }
  return out.reverse();
}

/** Message parts to draw; falls back to the plain message when Twitch sent no fragments. */
export function messageParts(e: Event): MessagePart[] {
  if (e.message_parts && e.message_parts.length) return e.message_parts;
  return e.message ? [{ type: 'text', text: e.message }] : [];
}

export function emoteUrl(id: string, size: '1.0' | '2.0' | '3.0' = '2.0'): string {
  return `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/default/dark/${size}`;
}

export type Role = 'broadcaster' | 'moderator' | 'vip' | 'subscriber';

export function roles(e: Event): Role[] {
  const r = e.roles;
  if (!r) return [];
  const out: Role[] = [];
  if (r.broadcaster) out.push('broadcaster');
  if (r.moderator) out.push('moderator');
  if (r.vip) out.push('vip');
  if (r.subscriber) out.push('subscriber');
  return out;
}
