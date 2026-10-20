import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/**
 * Emits /sw.js from src/client/sw/sw.js with the exact list of files to precache (the hashed build
 * output plus public files the shell needs). A new build changes the list, which updates the worker.
 */
function serviceWorker(): Plugin {
  return {
    name: 'track-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'index.html');
      // The shell is cached as "/": the assets server redirects /index.html to /.
      const files = [
        '/',
        ...built.map((f) => `/${f}`),
        '/manifest.webmanifest',
        '/theme-init.js',
        '/icons/icon-192.png',
        '/icons/favicon-32.png',
      ];
      const version = `${pkg.version}-${Date.now().toString(36)}`;
      const source = readFileSync(new URL('./src/client/sw/sw.js', import.meta.url), 'utf8')
        .replace('self.__TRACK_VERSION__', JSON.stringify(version))
        .replace('self.__TRACK_PRECACHE__', JSON.stringify(files));
      if (source.includes('__TRACK_')) this.error('service worker placeholders were not replaced');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { outDir: 'dist/client', emptyOutDir: true, sourcemap: true },
  server: {
    port: 5173,
    strictPort: true,
    // The Worker (wrangler dev) serves /api locally. Host stays "localhost", which the dev auth stub requires.
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: false } },
  },
});
