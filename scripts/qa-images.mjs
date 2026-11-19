import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
await context.addInitScript(() => {
  localStorage.setItem('paligraph-settings', JSON.stringify({ state: { theme: 'light', language: 'zh-CN' }, version: 1 }));
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.app-shell:not(.app-skeleton)');
await page.locator('.sidebar .new-note-button').click();
await page.waitForTimeout(400);

const imageInput = page.locator('input[type="file"][accept*="image"]');
await imageInput.setInputFiles(path.resolve('scripts/fixtures/vault/icon-64.png'));
await page.waitForTimeout(1200);
const selectionAfterInsert = await page.locator('.selection-toolbar').count();
const countAfterInsert = await page.locator('.selection-count').textContent().catch(() => null);
await page.screenshot({ path: 'screenshots/image-inserted.png' });

const readImages = () => page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open('paligraph-canvas');
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result;
    const tx = db.transaction('notes', 'readonly');
    const all = tx.objectStore('notes').getAll();
    all.onsuccess = () => {
      const notes = all.result.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve((notes[0]?.images ?? []).map((image) => ({ id: image.id, rotation: image.rotation, x: image.x, y: image.y })));
    };
  };
}));
await page.waitForTimeout(1000);
const before = await readImages();

await page.getByRole('button', { name: '选择', exact: true }).click();
const surfaceBox = await page.locator('.drawing-surface').boundingBox();
await page.mouse.click(surfaceBox.x + surfaceBox.width / 2, surfaceBox.y + surfaceBox.height / 2);
await page.waitForTimeout(300);
const selectedCount = await page.locator('.selection-count').textContent().catch(() => null);
const centerX = surfaceBox.x + surfaceBox.width / 2;
const centerY = surfaceBox.y + surfaceBox.height / 2;
await page.mouse.move(centerX, centerY);
await page.mouse.down();
await page.mouse.move(centerX + 90, centerY + 50, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(800);
const moved = await readImages();
await page.locator('.selection-action').nth(2).click();
await page.waitForTimeout(800);
const rotated = await readImages();
await page.keyboard.press('Control+c');
await page.keyboard.press('Control+v');
await page.waitForTimeout(800);
const pasted = await readImages();
await page.screenshot({ path: 'screenshots/image-rotated-copied.png' });

await page.keyboard.press('Delete');
await page.waitForTimeout(700);
const deleted = await readImages();
await page.keyboard.press('Control+z');
await page.waitForTimeout(800);
const undone = await readImages();

console.log(JSON.stringify({
  selectionAfterInsert,
  countAfterInsert,
  before,
  selectedCount,
  moved,
  rotated,
  pastedCount: pasted.length,
  deletedCount: deleted.length,
  undoneCount: undone.length,
  errors,
}, null, 2));
await browser.close();
