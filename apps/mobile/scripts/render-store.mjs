// Renders the Play Store graphics into store/ with the Chrome already on this Mac:
//   node scripts/render-store.mjs
// Builds the website first: the screenshots use its app screens (apps/web/illustrations).
// Dev-only; the PNGs are committed.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const store = join(root, 'store');
const page = pathToFileURL(join(store, 'source', 'store.html')).href;
const profile = mkdtempSync(join(tmpdir(), 'render-store-'));

execFileSync(process.execPath, [join(root, '..', 'web', 'build.mjs')], { stdio: 'inherit' });

/**
 * @param {string} query the store.html query (kind, n, lang)
 * @param {[number, number]} size the image size in pixels
 * @param {string} out the PNG to write
 */
function render(query, [width, height], out) {
  mkdirSync(dirname(out), { recursive: true });
  execFileSync(
    CHROME,
    [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--allow-file-access-from-files',
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      '--virtual-time-budget=2000', // let fonts and images load before the shot
      `--screenshot=${out}`,
      `${page}?${query}`,
    ],
    { stdio: 'ignore' },
  );
  console.log(out.slice(root.length + 1));
}

const SHOTS = ['today', 'attendance', 'whatsapp', 'fees', 'results', 'summary'];
try {
  render('kind=icon', [512, 512], join(store, 'icon-512.png'));
  for (const lang of ['en', 'hi']) {
    render(`kind=feature&lang=${lang}`, [1024, 500], join(store, lang, 'feature-graphic.png'));
    SHOTS.forEach((name, i) =>
      render(
        `kind=shot&n=${i + 1}&lang=${lang}`,
        [1080, 1920],
        join(store, lang, `${i + 1}-${name}.png`),
      ),
    );
  }
} finally {
  rmSync(profile, { recursive: true, force: true });
}
