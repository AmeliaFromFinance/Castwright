import changelog from '../../../CHANGELOG.md?raw';
import { loadPref, savePref } from '$lib/state/persist';
import { newerVersion } from '$lib/state/updates.svelte';
import { findRelease, parseChangelog, parseNotes, type Release } from './changelog';

const SEEN = 'whatsnew-seen';

export const RELEASES: Release[] = parseChangelog(changelog);

/**
 * What to do at start-up. `firstRun`: setup hasn't been finished, so this is a new
 * install. A missing `lastSeen` after setup means an update from before this existed.
 */
export function onStart(lastSeen: string | null, current: string, firstRun: boolean, hasNotes: boolean): 'show' | 'remember' | 'nothing' {
  if (!current) return 'nothing';
  if (firstRun) return 'remember';
  if (lastSeen && !newerVersion(current, lastSeen)) return 'nothing';
  return hasNotes ? 'show' : 'remember';
}

class WhatsNew {
  shown = $state<Release | null>(null);
  /** Download link when showing notes for a version that isn't installed yet. */
  download = $state<string | null>(null);

  start(current: string, firstRun: boolean) {
    const notes = findRelease(RELEASES, current);
    const todo = onStart(loadPref<string | null>(SEEN, null), current, firstRun, !!notes);
    if (todo !== 'nothing') savePref(SEEN, current);
    if (todo === 'show') this.shown = notes!;
  }

  /** Notes for the installed version, or the newest ones if it has none. */
  show(current: string) {
    this.download = null;
    this.shown = findRelease(RELEASES, current) ?? RELEASES.find((r) => !newerVersion(r.version, current)) ?? RELEASES[0] ?? null;
  }

  /** Notes for a newer release, from its GitHub release text. */
  showUpdate(version: string, body: string, url: string) {
    const notes = parseNotes(body, version);
    this.download = url;
    this.shown = notes.groups.length ? notes : null;
  }

  close() {
    this.shown = null;
    this.download = null;
  }
}

export const whatsNew = new WhatsNew();
