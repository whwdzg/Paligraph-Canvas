import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Renders public/icons/icon.svg to the PNG sizes referenced by the manifest,
 * favicon tags and the iOS home-screen icon. Uses an installed Edge/Chrome via
 * playwright-core so no browser download is required in this environment.
 *
 * Usage: node scripts/generate-icons.mjs
 */
const root = process.cwd();
const iconDir = path.join(root, 'public', 'icons');
const svg = await readFile(path.join(iconDir, 'icon.svg'), 'utf8');

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const executablePath = candidates.find((candidate) => existsSync(candidate));
if (!executablePath) throw new Error('No Chrome or Edge executable found. Set CHROME_PATH.');

const browser = await chromium.launch({ executablePath, headless: true });

async function render(size, filename) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block;width:${size}px;height:${size}px}</style>${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}`,
    { waitUntil: 'load' },
  );
  const buffer = await page.screenshot({ omitBackground: true, type: 'png' });
  await writeFile(path.join(iconDir, filename), buffer);
  await page.close();
  console.log(`wrote icons/${filename}`);
}

for (const [size, filename] of [
  [512, 'icon-512.png'],
  [192, 'icon-192.png'],
  [180, 'apple-touch-icon.png'],
  [64, 'icon-64.png'],
  [32, 'favicon-32.png'],
]) {
  await render(size, filename);
}

// Maskable icons need a generous safe area; the artwork is inset into a
// square canvas so Android's circular/squircle masks never clip the monogram.
const maskPage = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
await maskPage.setContent(
  `<!doctype html><style>html,body{margin:0;background:#0b1e3c;overflow:hidden}svg{display:block;width:410px;height:410px;position:absolute;left:51px;top:51px}</style>${svg.replace('<svg ', '<svg width="410" height="410" ')}`,
  { waitUntil: 'load' },
);
await writeFile(path.join(iconDir, 'icon-maskable-512.png'), await maskPage.screenshot({ type: 'png' }));
await maskPage.close();
console.log('wrote icons/icon-maskable-512.png');

await browser.close();
