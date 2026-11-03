import { api } from '$lib/api';

const RENEW_MS = 60_000;
let users = 0;
let timer: ReturnType<typeof setInterval> | null = null;

const ping = (on: boolean) => void api.musicWatch(on).catch(() => {});

/** Asks for fresh song updates while something in the app shows the song. Returns the stop function. */
export function watchMusic(): () => void {
  users++;
  if (users === 1) {
    ping(true);
    timer = setInterval(() => ping(true), RENEW_MS);
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    users--;
    if (users === 0) {
      if (timer) clearInterval(timer);
      timer = null;
      ping(false);
    }
  };
}
