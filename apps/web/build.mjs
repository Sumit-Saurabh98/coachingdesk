// Builds the static website into dist/ (Vercel serves that folder as-is).
//   node build.mjs
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { missingDetails, renderPage } from './lib.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const site = JSON.parse(readFileSync(join(root, 'site.json'), 'utf8'));

const missing = missingDetails(site);
if (missing.length > 0) {
  console.error(`site.json: fill these in before building: ${missing.join(', ')}`);
  process.exit(1);
}

const layout = readFileSync(join(root, 'layout.html'), 'utf8');
const out = join(root, 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(out);

// pages.json: each page's title and description; pages/<file>: its HTML body.
const pages = JSON.parse(readFileSync(join(root, 'pages.json'), 'utf8'));
for (const [file, meta] of Object.entries(pages)) {
  const body = readFileSync(join(root, 'pages', file), 'utf8');
  writeFileSync(join(out, file), renderPage(layout, { ...meta, body }, site));
}
for (const file of readdirSync(join(root, 'static'))) {
  copyFileSync(join(root, 'static', file), join(out, file));
}
console.log(`Built ${readdirSync(out).length} files into dist/`);
