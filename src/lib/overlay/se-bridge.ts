// StreamElements-compatible custom widget support: srcdoc building, event mapping
// and the message bridge between the page and the sandboxed iframe.
import type { Event } from '$lib/bindings/Event';
import { displayName } from './labels';
import { emoteUrl, messageParts, roles } from './chat';

const TAG = 'castwright';
export const MAX_KEY_LEN = 128;
export const MAX_VALUE_BYTES = 64 * 1024;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const MEDIA_FIELDS = new Set(['image-input', 'video-input', 'sound-input']);

/**
 * Field values: each field's default `value`, overridden by saved values.
 * Image, video and sound fields hold project paths like `assets/x.png`; `assetUrl`
 * turns them into full links the widget can load.
 */
export function fieldData(
  fields: Record<string, unknown>,
  values: Record<string, unknown>,
  assetUrl?: (path: string) => string
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, def] of Object.entries(fields ?? {})) {
    if (isObj(def) && 'value' in def) out[k] = def.value;
  }
  for (const [k, v] of Object.entries(values ?? {})) out[k] = v;
  if (assetUrl) {
    for (const [k, def] of Object.entries(fields ?? {})) {
      const v = out[k];
      if (isObj(def) && MEDIA_FIELDS.has(String(def.type)) && typeof v === 'string' && v) out[k] = assetUrl(v);
    }
  }
  return out;
}

function fieldText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

/**
 * Replaces `{{field}}` and `{field}` with field values. Like StreamElements, values are
 * inserted as-is (no HTML escaping), so a field can hold markup. Unknown names are left alone.
 */
export function substituteFields(src: string, data: Record<string, unknown>): string {
  return (src ?? '').replace(/\{\{\s*([\w.-]+)\s*\}\}|\{([\w-]+)\}/g, (m, a?: string, b?: string) => {
    const k = a ?? b ?? '';
    return Object.prototype.hasOwnProperty.call(data, k) ? fieldText(data[k]) : m;
  });
}

// Runs inside the iframe before the widget. Plain ES2017 so old OBS builds are fine.
const BOOTSTRAP = `(function(){
var P=window.parent,store={},editor=false;
function send(m){m.cw='${TAG}';try{P.postMessage(m,'*');}catch(e){}}
function fire(n,d){window.dispatchEvent(new CustomEvent(n,{detail:d}));}
function clone(v){if(v===undefined)return null;try{return JSON.parse(JSON.stringify(v));}catch(e){return null;}}
window.SE_API={
store:{
get:function(k){k=String(k);return Promise.resolve(Object.prototype.hasOwnProperty.call(store,k)?clone(store[k]):null);},
set:function(k,v){k=String(k);var c=clone(v);store[k]=c;send({type:'store_set',key:k,value:c});
fire('onEventReceived',{listener:'kvstore:update',event:{data:{key:'customWidget.'+k,value:c}}});return Promise.resolve();},
delete:function(k){k=String(k);delete store[k];send({type:'store_delete',key:k});return Promise.resolve();}
},
counters:{get:function(n){return Promise.resolve({counter:n,value:0});}},
resumeQueue:function(){},
getOverlayStatus:function(){return {isEditorMode:editor,muted:false};},
setField:function(){},
sanitize:function(o){return Promise.resolve({result:{message:o&&o.message!=null?String(o.message):''},skip:false});},
cheerFilter:function(m){return Promise.resolve(String(m==null?'':m).replace(/(^|\\s)cheer\\d+(?=\\s|$)/gi,'$1').replace(/\\s{2,}/g,' ').trim());}
};
window.addEventListener('message',function(e){
if(e.source!==P)return;var m=e.data;if(!m||m.cw!=='${TAG}')return;
if(m.type==='init'){store=m.store||{};editor=!!m.isEditorMode;fire('onWidgetLoad',m.detail);}
else if(m.type==='event'){fire('onEventReceived',m.detail);}
else if(m.type==='session'){fire('onSessionUpdate',m.detail);}
});
if(document.readyState==='complete')send({type:'ready'});else window.addEventListener('load',function(){send({type:'ready'});});
})();`;

export interface WidgetCode {
  html: string;
  css: string;
  js: string;
  fields: Record<string, unknown>;
  values: Record<string, unknown>;
}

export function buildSrcdoc(code: WidgetCode, assetUrl?: (path: string) => string): string {
  const data = fieldData(code.fields, code.values, assetUrl);
  const html = substituteFields(code.html, data);
  const css = substituteFields(code.css, data).replace(/<\/style/gi, '<\\/style');
  const js = substituteFields(code.js, data).replace(/<\/script/gi, '<\\/script');
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<style>html,body{margin:0;padding:0;width:100%;height:100%;background:transparent;overflow:hidden}</style>' +
    `<script>${BOOTSTRAP}</script>` +
    `<style>${css}</style></head><body>${html}<script>${js}\n</script></body></html>`
  );
}

// ---- Messages between page and iframe ------------------------------------

export type WidgetToPage =
  | { type: 'ready' }
  | { type: 'store_set'; key: string; value: unknown }
  | { type: 'store_delete'; key: string };

/** Validates a message from the widget iframe. The caller must already have checked `event.source`. */
export function parseWidgetMsg(data: unknown): WidgetToPage | null {
  if (!isObj(data) || data.cw !== TAG || typeof data.type !== 'string') return null;
  if (data.type === 'ready') return { type: 'ready' };
  if (data.type !== 'store_set' && data.type !== 'store_delete') return null;
  const key = data.key;
  if (typeof key !== 'string' || !key || key.length > MAX_KEY_LEN) return null;
  if (data.type === 'store_delete') return { type: 'store_delete', key };
  let json: string;
  try {
    json = JSON.stringify(data.value ?? null);
  } catch {
    return null;
  }
  if (json.length > MAX_VALUE_BYTES) return null;
  return { type: 'store_set', key, value: JSON.parse(json) as unknown };
}

export function pageMsg(type: 'init' | 'event' | 'session', payload: Record<string, unknown>): Record<string, unknown> {
  return { cw: TAG, type, ...payload };
}

// ---- Event mapping --------------------------------------------------------

export interface SeEvent {
  listener: string;
  event: Record<string, unknown>;
}

function tierCode(e: Event): string {
  if (e.data?.is_prime === true) return 'prime';
  return String(Math.min(3, Math.max(1, e.tier ?? 1)) * 1000);
}

function base(e: Event, type: string): Record<string, unknown> {
  return {
    type,
    name: displayName(e),
    displayName: displayName(e),
    providerId: e.user?.id ?? '',
    _id: e.id,
    provider: 'twitch',
    createdAt: new Date(e.ts || Date.now()).toISOString(),
    avatar: '',
    amount: e.amount ?? 0,
    message: e.message ?? '',
    items: []
  };
}

const BADGE_IMAGES: Record<string, { id: string; title: string }> = {
  broadcaster: { id: '5527c58c-fb7d-422d-b71b-f309dcb85cc1', title: 'Broadcaster' },
  moderator: { id: '3267646d-33f0-4b17-b3df-f923a41db1d0', title: 'Moderator' },
  vip: { id: 'b817aba4-fad8-49e2-b88a-7cc744dfa6ec', title: 'VIP' },
  subscriber: { id: '5d9f2208-5dd8-11e7-8513-2ff4adfae661', title: 'Subscriber' }
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** StreamElements' Twitch chat payload, as far as our event carries the data. */
export function seChatData(e: Event): { data: Record<string, unknown>; renderedText: string } {
  const parts = messageParts(e);
  const emotes: Record<string, unknown>[] = [];
  let pos = 0;
  let rendered = '';
  for (const p of parts) {
    const len = Array.from(p.text).length;
    if (p.type === 'emote') {
      emotes.push({
        type: 'twitch',
        name: p.text,
        id: p.id,
        gif: false,
        urls: { '1': emoteUrl(p.id, '1.0'), '2': emoteUrl(p.id, '2.0'), '4': emoteUrl(p.id, '3.0') },
        start: pos,
        end: pos + len - 1
      });
      rendered += `<img src="${escapeHtml(emoteUrl(p.id, '1.0'))}" srcset="${escapeHtml(emoteUrl(p.id, '1.0'))} 1x, ${escapeHtml(emoteUrl(p.id, '2.0'))} 2x, ${escapeHtml(emoteUrl(p.id, '3.0'))} 4x" title="${escapeHtml(p.text)}" class="emote">`;
    } else {
      rendered += escapeHtml(p.text);
    }
    pos += len;
  }
  const text = e.message ?? parts.map((p) => p.text).join('');
  const color = typeof e.data?.color === 'string' ? e.data.color : '';
  const r = roles(e);
  const badges = r.map((type) => {
    const b = BADGE_IMAGES[type]!;
    return {
      type,
      version: '1',
      url: `https://static-cdn.jtvnw.net/badges/v1/${b.id}/3`,
      description: b.title
    };
  });
  const login = e.user?.login ?? '';
  const userId = e.user?.id ?? '';
  const tags: Record<string, string> = {
    'badge-info': '',
    badges: r.map((t) => `${t}/1`).join(','),
    color,
    'display-name': displayName(e),
    emotes: emotes.map((m) => `${String(m.id)}:${String(m.start)}-${String(m.end)}`).join('/'),
    id: e.id,
    mod: e.roles?.moderator ? '1' : '0',
    subscriber: e.roles?.subscriber ? '1' : '0',
    'tmi-sent-ts': String(e.ts),
    'user-id': userId
  };
  return {
    data: {
      time: e.ts,
      tags,
      nick: login,
      userId,
      displayName: displayName(e),
      displayColor: color,
      badges,
      channel: '',
      text,
      isAction: e.data?.is_action === true,
      emotes,
      msgId: e.id
    },
    renderedText: rendered
  };
}

/** Maps one of our events to a StreamElements `onEventReceived` payload, or null if SE has no equivalent. */
export function toSeEvent(e: Event): SeEvent | null {
  switch (e.kind) {
    case 'follow':
      return { listener: 'follower-latest', event: base(e, 'follower') };
    case 'sub':
    case 'resub':
      return {
        listener: 'subscriber-latest',
        event: { ...base(e, 'subscriber'), amount: e.months ?? 1, tier: tierCode(e), gifted: false }
      };
    case 'gift_sub': {
      const gifter = displayName(e);
      const recipient = e.recipient?.display_name || e.recipient?.login || '';
      return {
        listener: 'subscriber-latest',
        event: {
          ...base(e, 'subscriber'),
          name: recipient || gifter,
          displayName: recipient || gifter,
          amount: e.months ?? 1,
          tier: tierCode(e),
          gifted: true,
          sender: gifter,
          isCommunityGift: typeof e.data?.community_gift_id === 'string' || e.data?.community_gift_id === true
        }
      };
    }
    case 'community_gift':
      return {
        listener: 'subscriber-latest',
        event: {
          ...base(e, 'subscriber'),
          amount: e.amount ?? 1,
          tier: tierCode(e),
          gifted: true,
          bulkGifted: true,
          sender: displayName(e)
        }
      };
    case 'cheer':
      return { listener: 'cheer-latest', event: base(e, 'cheer') };
    case 'raid':
      return { listener: 'raid-latest', event: base(e, 'raid') };
    case 'charity':
      return { listener: 'tip-latest', event: { ...base(e, 'tip'), currency: e.currency ?? '' } };
    case 'chat':
      return { listener: 'message', event: seChatData(e) };
    default:
      return null;
  }
}

const SESSION_KINDS: Record<string, string> = {
  'follower-latest': 'follower',
  'subscriber-latest': 'subscriber',
  'cheer-latest': 'cheer',
  'raid-latest': 'raid',
  'tip-latest': 'tip'
};

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** SE `recents`: mapped events, newest first. */
export function seRecents(recent: readonly Event[], max = 25): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let i = recent.length - 1; i >= 0 && out.length < max; i--) {
    const e = recent[i];
    if (!e || e.kind === 'chat') continue;
    const m = toSeEvent(e);
    if (m) out.push(m.event);
  }
  return out;
}

/** SE session data: latest per type, short recent lists and session totals from variables. */
export function seSession(recent: readonly Event[], vars: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const lists: Record<string, Record<string, unknown>[]> = {};
  for (const [listener, type] of Object.entries(SESSION_KINDS)) {
    data[listener] = { name: '', amount: 0, message: '' };
    lists[`${type}-recent`] = [];
  }
  for (let i = recent.length - 1; i >= 0; i--) {
    const e = recent[i];
    if (!e) continue;
    const m = toSeEvent(e);
    if (!m || !(m.listener in SESSION_KINDS)) continue;
    const latest = data[m.listener] as Record<string, unknown>;
    if (!latest._id) data[m.listener] = m.event;
    const list = lists[`${SESSION_KINDS[m.listener]}-recent`];
    if (list && list.length < 25) list.push(m.event);
  }
  Object.assign(data, lists);
  data['follower-session'] = { count: num(vars['session.follows']) };
  data['subscriber-session'] = { count: num(vars['session.subs']) };
  data['subscriber-gifted-session'] = { count: num(vars['session.gifts']) };
  data['cheer-session'] = { amount: num(vars['session.bits']) };
  data['raid-session'] = { count: num(vars['session.raids']) };
  data['tip-session'] = { amount: num(vars['session.donations']) };
  return data;
}

export function widgetLoadDetail(opts: {
  fields: Record<string, unknown>;
  values: Record<string, unknown>;
  recent: readonly Event[];
  vars: Record<string, unknown>;
  isEditorMode: boolean;
  assetUrl?: (path: string) => string;
}): Record<string, unknown> {
  const login = opts.vars['twitch.login'];
  return {
    fieldData: fieldData(opts.fields, opts.values, opts.assetUrl),
    channel: { username: typeof login === 'string' ? login : '', apiToken: '', id: '', providerId: '', avatar: '' },
    session: { data: seSession(opts.recent, opts.vars), settings: { autoReset: false } },
    recents: seRecents(opts.recent),
    currency: { code: 'USD', name: 'U.S. Dollar', symbol: '$' },
    overlay: { isEditorMode: opts.isEditorMode, muted: false },
    emulated: false
  };
}
