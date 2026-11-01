import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Backend } from './backend';

export const tauriBackend: Backend = {
  kind: 'tauri',
  invoke: (cmd, args) => invoke(cmd, args),
  listen: async (event, cb) => listen(event, (e) => cb(e.payload as never))
};
