import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {appendFileSync, mkdirSync, readdirSync, renameSync, statSync} from 'node:fs';
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

/**
 * Dev-only sink for the app's debug capture (src/services/debugCapture.ts).
 *
 * The app POSTs newline-delimited per-beat JSON here and the plugin appends it
 * to `.unruh-debug/live.ndjson`, so the data can be inspected with jq/python
 * instead of being copy-pasted out of the UI by hand. Kept out of the build
 * (`apply: 'serve'`): GitHub Pages has no endpoint and must not receive
 * accidental writes.
 *
 * Rotation keeps a long live session from growing without bound; the previous
 * file stays next to it for comparison.
 */
const unruhDebugSinkPlugin = {
  name: 'unruh-debug-sink',
  apply: 'serve' as const,
  configureServer(server: ViteDevServer) {
    const dir = path.join(__dirname, '.unruh-debug');
    const file = path.join(dir, 'live.ndjson');
    const MAX_BYTES = 20 * 1024 * 1024;
    const MAX_BODY = 8 * 1024 * 1024;
    let lines = 0;

    const rotateIfNeeded = () => {
      let size = 0;
      try {
        size = statSync(file).size;
      } catch {
        return;
      }
      if (size >= MAX_BYTES) {
        renameSync(file, path.join(dir, `live-${Date.now()}.ndjson`));
        lines = 0;
      }
    };

    server.middlewares.use((req: Connect.IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
      const url = new URL(req.url || '/', 'http://localhost');
      const isSink = url.pathname === '/unruh/__unruh-debug' || url.pathname === '/__unruh-debug';
      const isStatus =
        url.pathname === '/unruh/__unruh-debug/status' || url.pathname === '/__unruh-debug/status';
      const isReset =
        url.pathname === '/unruh/__unruh-debug/reset' || url.pathname === '/__unruh-debug/reset';

      // "Clear" in the panel rotates instead of truncating, so the previous run
      // stays on disk for comparison (mic run vs synthesizer run, before vs
      // after a landmark change).
      if (isReset) {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        try {
          if (statSync(file).size > 0) {
            renameSync(file, path.join(dir, `live-${Date.now()}.ndjson`));
          }
        } catch {
          /* nothing captured yet */
        }
        lines = 0;
        res.statusCode = 204;
        res.end();
        return;
      }

      if (isStatus) {
        let bytes = 0;
        let updatedAt: string | null = null;
        try {
          const st = statSync(file);
          bytes = st.size;
          updatedAt = st.mtime.toISOString();
        } catch {
          /* no capture yet */
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ok: true, file: '.unruh-debug/live.ndjson', bytes, lines, updatedAt}));
        return;
      }

      if (isSink) {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        let body = '';
        let tooLarge = false;
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => {
          body += chunk;
          if (body.length > MAX_BODY) {
            tooLarge = true;
            req.destroy();
          }
        });
        req.on('end', () => {
          if (tooLarge) return;
          try {
            mkdirSync(dir, {recursive: true});
            rotateIfNeeded();
            appendFileSync(file, body.endsWith('\n') ? body : `${body}\n`);
            lines += body.split('\n').filter((line) => line.trim().length > 0).length;
            res.statusCode = 204;
            res.end();
          } catch (err) {
            res.statusCode = 500;
            res.end(String(err));
          }
        });
        return;
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
      unruhDebugSinkPlugin,
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
