import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@torve\/node\/discovery$/, replacement: resolve(__dirname, '../packages/node/src/discovery/index.ts') },
      { find: /^@torve\/node\/metering$/, replacement: resolve(__dirname, '../packages/node/src/metering/index.ts') },
      { find: /^@torve\/node$/, replacement: resolve(__dirname, '../packages/node/src/index.ts') },
      { find: /^@torve\/provider-core$/, replacement: resolve(__dirname, '../packages/provider-core/src/index.ts') },
      { find: /^@torve\/provider-anthropic$/, replacement: resolve(__dirname, '../plugins/provider-anthropic/src/index.ts') },
      { find: /^@torve\/router-local$/, replacement: resolve(__dirname, '../plugins/router-local/src/index.ts') },
    ],
  },
  test: {
    testTimeout: 60_000,
    hookTimeout: 30_000,
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
  },
});
