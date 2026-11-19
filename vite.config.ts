import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Paligraph build configuration.
 *
 * The app is deployed to GitHub Pages under /Paligraph-Canvas/, but the same
 * source runs at the domain root locally. `base` is therefore driven by the
 * GITHUB_ACTIONS flag so asset URLs, the manifest and locale requests all stay
 * correct in both environments. React and the icon set are split into
 * long-cacheable chunks; PDF tooling is only fetched on export.
 */
const pkg = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')) as { version?: string };

const repositoryBase = '/Paligraph-Canvas/';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? repositoryBase : '/',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version ?? '0.0.0'),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    sourcemap: false,
    reportCompressedSize: true,
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/scheduler/')) {
            return 'react';
          }
          if (id.includes('node_modules/@fluentui/react-icons/')) return 'fluent-icons';
          if (id.includes('node_modules/zustand/')) return 'state';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 4173,
    strictPort: true,
    watch: {
      ignored: ['**/dist/**', '**/.tmp/**', '**/*.tmpdir/**', '**/.git/**'],
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
