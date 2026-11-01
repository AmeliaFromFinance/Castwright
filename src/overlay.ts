import { mount } from 'svelte';
import { parseLocation } from '$lib/overlay/connection';
import OverlayApp from '$lib/overlay/OverlayApp.svelte';
import { OverlayRuntime } from '$lib/overlay/runtime.svelte';

const assetKey = document.querySelector<HTMLMetaElement>('meta[name="cw-asset-key"]')?.content ?? '';
const endpoint = parseLocation(location, assetKey);
// Custom widget frames inherit this page's base URL; keep the token out of it.
const base = document.createElement('base');
base.href = `${location.origin}${location.pathname}`;
document.head.prepend(base);
if (!endpoint.overlayId) console.warn('[overlay] no overlay id in the URL');
if (!endpoint.token) console.warn('[overlay] no token in the URL');

const runtime = new OverlayRuntime({ endpoint });
const target = document.getElementById('overlay') ?? document.body;

mount(OverlayApp, { target, props: { runtime } });
runtime.start();
