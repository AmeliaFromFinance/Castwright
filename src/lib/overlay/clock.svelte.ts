// One shared one-second tick for every timer, aligned to wall-clock seconds so
// all timers change together and never drift.
let now = $state(Date.now());
let users = 0;
let handle: ReturnType<typeof setTimeout> | null = null;

function schedule() {
  handle = setTimeout(
    () => {
      now = Date.now();
      schedule();
    },
    1000 - (Date.now() % 1000) + 2
  );
}

export const clock = {
  get now() {
    return now;
  }
};

/** Starts the tick while at least one caller needs it. Returns the stop function. */
export function useClock(): () => void {
  users++;
  if (handle === null) {
    now = Date.now();
    schedule();
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    users--;
    if (users <= 0 && handle !== null) {
      clearTimeout(handle);
      handle = null;
      users = 0;
    }
  };
}
