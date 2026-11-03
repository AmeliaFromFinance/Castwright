import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    // Client builds of Svelte, so tests can mount components.
    resolve: { conditions: ['browser'] },
    test: {
      include: ['src/**/*.test.ts'],
      environment: 'jsdom'
    }
  })
);
