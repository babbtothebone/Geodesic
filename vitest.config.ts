import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // Workspace packages are symlinked into node_modules and their built dist/ is gitignored, so
  // resolve them straight to source. This keeps `vitest` working with no prior build (as in CI)
  // and sidesteps Vite's symlink/spaced-path resolution failures (e.g. a "Dire Wulf" path).
  resolve: {
    alias: {
      '@geodesic/types': path.resolve(import.meta.dirname, 'packages/types/src/index.ts'),
      '@geodesic/engine': path.resolve(import.meta.dirname, 'packages/engine/src/index.ts'),
    },
  },
  test: {
    passWithNoTests: true,
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/tests/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/**/*.test.ts', '**/dist/**'],
    },
  },
});
