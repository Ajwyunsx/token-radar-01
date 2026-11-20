// Take the three dossier screenshots with headless Chrome, from the local file, no server needed.
//   node main.ts (writes out/) && node tools/screenshot.mjs
// 1440 wide is the gate's long-side ceiling; the heights are tuned so each PNG lands in 300-350 KB.
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] || 'out');
const dest = resolve(process.argv[3] || 'screenshots');
mkdirSync(dest, { recursive: true });
const page = `file://${join(root, 'dashboard', 'index.html')}`;

const views = [
  ['1-board.png', '#/board', 1180],
  ['2-detail.png', '#/p/steakhouse-financial', 1180],
  ['3-filtered.png', '#/filtered?cat=Risk%20Curators', 1440],
];

for (const [name, hash, height] of views) {
  const out = join(dest, name);
  execFileSync('google-chrome', [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=1440,${height}`,
    '--virtual-time-budget=4000',
    `--screenshot=${out}`,
    `${page}${hash}`,
  ], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 90_000 });
  console.log(name, statSync(out).size, 'bytes');
}
