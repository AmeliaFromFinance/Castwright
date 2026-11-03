// What the editor's sample hype train shows: "Show level up" raises its level,
// and `ended` shows the end text instead.
export const hypePreview = $state<{ bumps: number; ended: boolean }>({ bumps: 0, ended: false });
