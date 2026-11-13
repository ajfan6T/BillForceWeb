/**
 * Build the BILLFORCE website (published on GitHub Pages by .github/workflows/pages.yml) into dist-website/:
 * the pages in website/ with the current version filled in, plus the logo and the CNAME file for billforce.in.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'website');
const out = path.join(root, 'dist-website');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });
for (const file of fs.readdirSync(out, { recursive: true })) {
  const p = path.join(out, String(file));
  if (p.endsWith('.html')) fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('{{VERSION}}', version));
}
fs.copyFileSync(path.join(root, 'public/icon.svg'), path.join(out, 'icon.svg'));
fs.copyFileSync(path.join(root, 'electron/assets/icon.png'), path.join(out, 'icon.png'));
// Serve the files as they are (no Jekyll processing on GitHub Pages).
fs.writeFileSync(path.join(out, '.nojekyll'), '');
// The website's own domain (GitHub Pages serves it there; the old github.io address redirects to it).
fs.writeFileSync(path.join(out, 'CNAME'), 'billforce.in\n');
console.log(`Website built in ${path.relative(root, out)}/ (version ${version})`);
