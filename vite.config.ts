import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

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
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // Keep the hand-authored manifest in public/ so the existing icon,
      // shortcut and display configuration stays under direct control.
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,json,woff2}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
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
