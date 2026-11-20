import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
].filter(Boolean);
const executablePath = candidates.find((candidate) => existsSync(candidate));
if (!executablePath) throw new Error('No browser found.');

const source = JSON.stringify({
  format: 'paligraph-note',
  version: 1,
  exportedAt: new Date().toISOString(),
  note: {
    title: 'Opened from Explorer',
    markdown: '# Opened from Explorer\n\nThis note came from a .paligraph file.',
    strokes: [],
    images: [],
    background: { pattern: 'grid', lineStyle: 'solid', spacing: 32, opacity: 0.14, color: '' },
  },
});

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' });
await context.addInitScript(({ content }) => {
  let consumer = null;
  Object.defineProperty(window, 'launchQueue', {
    configurable: true,
    value: {
      setConsumer(callback) {
        consumer = callback;
        window.setTimeout(async () => {
          if (!consumer) return;
          const file = new File([content], 'Explorer note.paligraph', { type: 'application/x-paligraph+json' });
          await consumer({ files: [{ getFile: async () => file }] });
        }, 1200);
      },
    },
  });
}, { content: source });

const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.app-shell:not(.app-skeleton)');

const manifest = await page.evaluate(async () => {
  const value = await (await fetch('./manifest.webmanifest')).json();
  return {
    handlers: value.file_handlers?.length ?? 0,
    extensions: value.file_handlers?.[0]?.accept?.['application/x-paligraph+json'] ?? [],
    launchMode: value.launch_handler?.client_mode ?? [],
  };
});

await page.waitForTimeout(2200);
const titles = await page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open('paligraph-canvas');
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result;
    const all = db.transaction('notes', 'readonly').objectStore('notes').getAll();
    all.onsuccess = () => resolve(all.result.map((note) => note.title));
    all.onerror = () => reject(all.error);
  };
}));

console.log(JSON.stringify({
  manifest,
  titles,
  pass: manifest.handlers === 1
    && manifest.extensions.includes('.paligraph')
    && titles.includes('Opened from Explorer'),
  errors,
}, null, 2));
await browser.close();
