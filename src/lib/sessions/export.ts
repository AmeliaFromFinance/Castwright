import { api } from '$lib/api';
import { isTauri } from '$lib/api/backend';

const TYPES = {
  png: { name: 'PNG image', mime: 'image/png' },
  csv: { name: 'CSV', mime: 'text/csv' },
  json: { name: 'JSON', mime: 'application/json' }
} as const;

export type ExportType = keyof typeof TYPES;

/**
 * Ask where to save, then write the file. `data` is text, or base64 for PNG.
 * Returns false when the person cancels.
 */
export async function saveExport(baseName: string, type: ExportType, data: string): Promise<boolean> {
  const file = `${baseName}.${type}`;
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ defaultPath: file, filters: [{ name: TYPES[type].name, extensions: [type] }] });
    if (!path) return false;
    await api.saveExport(path, data, type === 'png');
    return true;
  }
  const href = type === 'png' ? `data:image/png;base64,${data}` : URL.createObjectURL(new Blob([data], { type: TYPES[type].mime }));
  const a = document.createElement('a');
  a.href = href;
  a.download = file;
  a.click();
  if (type !== 'png') setTimeout(() => URL.revokeObjectURL(href), 1000);
  return true;
}
