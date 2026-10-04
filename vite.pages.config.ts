/**
 * Build of the browser edition for GitHub Pages (npm run build:pages -> dist-pages/).
 * The Billforce core runs in the page: Node's built-in modules are replaced by
 * the stand-ins in src/standalone/node (SQLite via sql.js, files in IndexedDB).
 */
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

const root = import.meta.dirname || process.cwd();
const r = (p: string) => path.resolve(root, p);

export default defineConfig({
  // Relative asset paths: works at https://<user>.github.io/<repo>/ (the app uses hash routes).
  base: './',
  plugins: [react(), tailwindcss()],
  define: {
    'process.platform': JSON.stringify('browser'),
  },
  resolve: {
    alias: [
      { find: '@transport', replacement: r('src/standalone/transport.ts') },
      { find: /^node:sqlite$/, replacement: r('src/standalone/node/sqlite.ts') },
      { find: /^node:fs\/promises$/, replacement: r('src/standalone/node/fsPromises.ts') },
      { find: /^node:fs$/, replacement: r('src/standalone/node/fs.ts') },
      { find: /^node:path$/, replacement: r('src/standalone/node/path.ts') },
      { find: /^node:os$/, replacement: r('src/standalone/node/os.ts') },
      { find: /^node:crypto$/, replacement: r('src/standalone/node/crypto.ts') },
      { find: /^@\//, replacement: `${r('.')}/` },
    ],
  },
  build: {
    outDir: 'dist-pages',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
});
