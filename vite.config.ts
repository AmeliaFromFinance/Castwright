import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

const host = process.env.TAURI_DEV_HOST;
const debug = !!process.env.TAURI_ENV_DEBUG;

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: { $lib: resolve(import.meta.dirname, 'src/lib') }
  },
  clearScreen: false,
  // Scan lazily loaded pages too, so the dev server doesn't reload when one opens.
  optimizeDeps: { entries: ['index.html', 'overlay.html', 'src/**/*.svelte'] },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**', '**/docs-site/**'] }
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: ['es2020', 'chrome103', 'safari15'],
    assetsDir: '_app',
    minify: !debug,
    sourcemap: debug,
    // Loaded from disk, not the network; the code editor chunk is large but lazy.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        overlay: resolve(import.meta.dirname, 'overlay.html')
      }
    }
  }
});
