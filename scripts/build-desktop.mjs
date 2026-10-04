/**
 * Build the Windows app into dist-desktop/ (packaged into Billforce-Setup.exe by electron-builder):
 *   renderer/     the screens (vite.desktop.config.ts)
 *   main.cjs      the app and the whole Billforce engine in one file (no node_modules needed)
 *   preload.cjs   the bridge between the screens and the engine
 *   package.json  name, version and entry point of the app
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as viteBuild } from 'vite';
import { build as esbuild } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist-desktop');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

fs.rmSync(out, { recursive: true, force: true });

await viteBuild({ configFile: path.join(root, 'vite.desktop.config.ts'), root, logLevel: 'warn' });

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: false,
  logLevel: 'warning',
  legalComments: 'none',
};
await esbuild({ ...common, entryPoints: [path.join(root, 'electron/main.ts')], outfile: path.join(out, 'main.cjs') });
await esbuild({ ...common, entryPoints: [path.join(root, 'electron/preload.ts')], outfile: path.join(out, 'preload.cjs') });

fs.copyFileSync(path.join(root, 'electron/assets/icon.png'), path.join(out, 'icon.png'));
fs.writeFileSync(
  path.join(out, 'package.json'),
  JSON.stringify(
    {
      name: 'billforce',
      productName: 'BILLFORCE',
      version: pkg.version,
      description: 'Billing, stock, accounts and GST for shops - BILLFORCE ERP',
      author: { name: 'BILLFORCE' },
      license: 'MIT',
      main: 'main.cjs',
    },
    null,
    2,
  ),
);
console.log(`Windows app built in ${path.relative(root, out)}/ (version ${pkg.version})`);
