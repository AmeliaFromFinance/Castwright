export interface MenuGroup<V extends string> {
  label?: string;
  items: Array<{ value: V; label: string; hint?: string }>;
}
