// Renders the brand SVGs (assets/brand) to the PNGs app.json uses (assets/images), with the
// Chrome already installed on this Mac. Run after changing a brand SVG:
//   node scripts/render-brand.mjs
// Dev-only: the PNGs are committed, so builds never need Chrome.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brand = join(root, 'assets', 'brand');
const profile = mkdtempSync(join(tmpdir(), 'render-brand-')); // a throwaway Chrome profile

try {
  for (const file of readdirSync(brand).filter((f) => f.endsWith('.svg'))) {
    const out = join(root, 'assets', 'images', file.replace(/\.svg$/, '.png'));
    execFileSync(
      CHROME,
      [
        '--headless',
        '--disable-gpu',
        '--hide-scrollbars',
        `--user-data-dir=${profile}`,
        '--default-background-color=00000000', // keep transparency
        '--window-size=1024,1024',
        `--screenshot=${out}`,
        pathToFileURL(join(brand, file)).href,
      ],
      { stdio: 'ignore' },
    );
    console.log(`assets/images/${file.replace(/\.svg$/, '.png')}`);
  }
} finally {
  rmSync(profile, { recursive: true, force: true });
}
