// Builds the static website into dist/ (Vercel serves that folder as-is).
//   node build.mjs
// English pages at /, Hindi at /hi; illustrations per language under /images/<lang>/.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fill, LANGUAGES, missingDetails, PAGES, renderPage } from './lib.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');
const site = JSON.parse(read('site.json'));

const missing = missingDetails(site);
if (missing.length > 0) {
  console.error(`site.json: fill these in before building: ${missing.join(', ')}`);
  process.exit(1);
}

const out = join(root, 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
const layout = read('templates', 'layout.html');

for (const lang of LANGUAGES) {
  const content = JSON.parse(read('content', `${lang}.json`));
  const pageDir = lang === 'en' ? out : join(out, lang);
  mkdirSync(pageDir, { recursive: true });
  for (const page of PAGES) {
    // The home page is one template for both languages; legal pages are written per language.
    const body =
      page === 'index'
        ? read('templates', 'index.html')
        : read('templates', 'legal', lang, `${page}.html`);
    writeFileSync(
      join(pageDir, `${page}.html`),
      renderPage(layout, body, { site, content, lang, page }),
    );
  }
  const imageDir = join(out, 'images', lang);
  mkdirSync(imageDir, { recursive: true });
  for (const file of readdirSync(join(root, 'illustrations'))) {
    const svg = read('illustrations', file);
    writeFileSync(join(imageDir, file), fill(svg, { site, content, lang, page: 'index' }));
  }
}
for (const file of readdirSync(join(root, 'static'))) {
  copyFileSync(join(root, 'static', file), join(out, file));
}
console.log('Built the website into dist/ (en + hi)');
