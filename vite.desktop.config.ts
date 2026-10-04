/**
 * Screens of the Windows app (npm run build:desktop -> dist-desktop/renderer/). Same React app as the
 * website; API calls go to the engine inside the app (src/desktop/transport.ts).
 */
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

const root = import.meta.dirname || process.cwd();

export default defineConfig({
  // Loaded from files on the computer (file://), so every path is relative. The app uses hash routes.
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@transport': path.resolve(root, 'src/desktop/transport.ts'),
      '@': path.resolve(root, '.'),
    },
  },
  build: {
    outDir: 'dist-desktop/renderer',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
});
