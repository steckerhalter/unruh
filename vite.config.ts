import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {readdirSync, statSync} from 'node:fs';
import type {ServerResponse} from 'node:http';
import {defineConfig, type Connect, type ViteDevServer} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

/**
 * Dev-server plugin that lists the files in the public `recordings` folder as
 * JSON — lets the app populate its recordings list without filesystem
 * permissions (GET /unruh/recordings/ → ["file.ogg", ...]).
 */
const unruhRecordingsListingPlugin = {
  name: 'unruh-recordings-listing',
  configureServer(server: ViteDevServer) {
    server.middlewares.use((req: Connect.IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
      try {
        const url = new URL(req.url || '/', 'http://localhost');
        if (url.pathname === '/unruh/recordings/' || url.pathname === '/recordings/') {
          const dir = path.join(__dirname, 'public', 'recordings');
          const names = readdirSync(dir)
            .filter((name) => statSync(path.join(dir, name)).isFile())
            .filter((name) => /\.(ogg|wav|mp3|m4a|aac|flac|aiff|aif|wma)$/i.test(name))
            .sort();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(names));
          return;
        }
      } catch {
        /* fall through */
      }
      next();
    });
  },
};

export default defineConfig(() => {
  return {
    base: '/unruh/',
    plugins: [
      react(),
      tailwindcss(),
      unruhRecordingsListingPlugin,
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'icon.svg', 'apple-touch-icon.png'],
        manifest: {
          id: '/',
          name: 'Unruh Mechanical Watch Timegrapher',
          short_name: 'Unruh',
          description: 'Precision mechanical watch timing, rate regulator oscilloscope, amplitude & beat error analyzer.',
          theme_color: '#07090e',
          background_color: '#07090e',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
