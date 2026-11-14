/**
 * Package the built server edition (run `npm run build` first) as release/Billforce-Server.tar.gz:
 * a folder "billforce-server" with the built app, package files, a Dockerfile and README.txt.
 * People install it with `npm ci --omit=dev && npm start` or `docker build`; no source code needed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!fs.existsSync(path.join(root, 'dist/server.js')) || !fs.existsSync(path.join(root, 'dist/index.html'))) {
  throw new Error('Build the server edition first: npm run build');
}
const outDir = path.join(root, 'release');
const stage = path.join(outDir, 'billforce-server');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
for (const item of ['dist', 'public', 'supabase_schema.sql', 'package.json', 'package-lock.json']) {
  fs.cpSync(path.join(root, item), path.join(stage, item), { recursive: true });
}
fs.copyFileSync(path.join(root, 'packaging/server/Dockerfile'), path.join(stage, 'Dockerfile'));
fs.copyFileSync(path.join(root, 'packaging/server/install-linux.sh'), path.join(stage, 'install-linux.sh'));
fs.chmodSync(path.join(stage, 'install-linux.sh'), 0o755);
fs.writeFileSync(path.join(stage, '.dockerignore'), 'node_modules\ndata\n');
fs.writeFileSync(path.join(stage, 'README.txt'), fs.readFileSync(path.join(root, 'packaging/server/README.txt'), 'utf8').replaceAll('{{VERSION}}', version));
const archive = path.join(outDir, 'Billforce-Server.tar.gz');
fs.rmSync(archive, { force: true });
execFileSync('tar', ['-czf', archive, '-C', outDir, 'billforce-server']);
console.log(`Packaged ${path.relative(root, archive)} (version ${version})`);
