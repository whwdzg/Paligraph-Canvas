import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
].filter(Boolean);
const executablePath = candidates.find((candidate) => existsSync(candidate));
if (!executablePath) throw new Error('No browser found.');

await mkdir('screenshots', { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' });
await context.addInitScript(() => {
  localStorage.setItem('paligraph-settings', JSON.stringify({ state: { theme: 'light', language: 'zh-CN' }, version: 1 }));
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});

async function images() {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('paligraph-canvas');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const all = request.result.transaction('notes', 'readonly').objectStore('notes').getAll();
      all.onerror = () => reject(all.error);
      all.onsuccess = () => {
        const note = all.result.sort((a, b) => b.updatedAt - a.updatedAt)[0];
        resolve((note.images ?? []).map((image) => ({
          id: image.id,
          x: image.x,
          y: image.y,
          width: image.width,
          height: image.height,
        })));
      };
    };
  }));
}

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.app-shell:not(.app-skeleton)');
await page.locator('.sidebar .new-note-button').click();
await page.waitForTimeout(300);
await page.locator('.hint-dismiss').click();
await page.locator('input[type=file][accept*="image/png"]').setInputFiles('public/icons/icon-192.png');
await page.waitForTimeout(800);
const before = await images();

await page.locator('.tool-button[aria-label="选择"]').click();
const box = await page.locator('.drawing-surface').boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
// The imported 192×192 icon is centred at 100%; drag its bottom-right corner.
await page.mouse.move(cx + 96, cy + 96);
await page.mouse.down();
for (let step = 1; step <= 8; step += 1) {
  await page.mouse.move(cx + 96 + step * 10, cy + 96 + step * 10, { steps: 2 });
}
await page.mouse.up();
await page.waitForTimeout(900);
const after = await images();
await page.screenshot({ path: 'screenshots/image-resized.png' });

await page.locator('.tool-button[aria-label="撤销"]').click();
await page.waitForTimeout(1600);
const undone = await images();

console.log(JSON.stringify({
  before,
  after,
  undone,
  pass: before.length === 1
    && after.length === 1
    && before[0].id === after[0].id
    && after[0].width > before[0].width * 1.2
    && Math.abs(after[0].width - after[0].height) < 0.5
    && Math.abs(undone[0].width - before[0].width) < 0.5,
  errors,
}, null, 2));
await browser.close();
