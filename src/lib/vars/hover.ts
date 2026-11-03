import { getContext, setContext } from 'svelte';

export interface VarCard {
  key: string;
  value: unknown;
  exists: boolean;
  usedIn: number;
  problem: string | null;
}

/** Lets template fields show a card for the variables in them. Set by the automation inspector. */
export interface VarHover {
  /** The variable a template key refers to, or null for run and event values. */
  card(key: string): VarCard | null;
  open(key: string): void;
}

const KEY = Symbol('var-hover');

export const provideVarHover = (h: VarHover): VarHover => setContext(KEY, h);
export const varHover = (): VarHover | undefined => getContext<VarHover | undefined>(KEY);
