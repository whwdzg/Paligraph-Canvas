import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', acceptDownloads: true });
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

// Draw a short stroke and add a raster image plus an SVG image.
const box = await page.locator('.drawing-surface').boundingBox();
await page.mouse.move(box.x + 300, box.y + 240);
await page.mouse.down();
await page.mouse.move(box.x + 620, box.y + 320, { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(200);
const imageInput = page.locator('input[type="file"][accept*="image"]');
await imageInput.setInputFiles([
  path.resolve('scripts/fixtures/vault/icon-64.png'),
  path.resolve('public/icons/icon.svg'),
]);
await page.waitForTimeout(1500);
await page.screenshot({ path: 'screenshots/export-source.png' });

const imageCount = await page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open('paligraph-canvas');
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result;
    const tx = db.transaction('notes', 'readonly');
    const all = tx.objectStore('notes').getAll();
    all.onsuccess = () => {
      const notes = all.result.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve((notes[0]?.images ?? []).length);
    };
  };
}));

async function exportFromMenu(label, filename) {
  await page.getByRole('button', { name: '导出' }).click();
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await page.getByRole('menuitem', { name: new RegExp(label) }).click();
  const download = await downloadPromise;
  const target = path.resolve('screenshots', filename);
  await download.saveAs(target);
  await page.waitForTimeout(400);
  return target;
}

const pngPath = await exportFromMenu('PNG 图片', 'exported-note.png');
const svgPath = await exportFromMenu('SVG 图片', 'exported-note.svg');
const editablePath = await exportFromMenu('Paligraph 笔记', 'exported-note.paligraph');
const editable = JSON.parse(await readFile(editablePath, 'utf8'));
const svg = await readFile(svgPath, 'utf8');

await page.getByRole('button', { name: '导入', exact: true }).first().click();
await page.waitForSelector('.import-modal');
const editableInput = page.locator('.import-modal input[accept*=".paligraph"]');
await editableInput.setInputFiles(editablePath);
await page.waitForTimeout(1500);
const noteCount = await page.locator('.note-card').count();
await page.screenshot({ path: 'screenshots/export-imported.png' });

console.log(JSON.stringify({
  imageCount,
  pngPath,
  svgPath,
  editablePath,
  editableFormat: editable.format,
  editableImages: editable.note?.images?.length,
  editableStrokes: editable.note?.strokes?.length,
  svgHasImages: svg.includes('<image '),
  svgHasPaths: svg.includes('<path '),
  noteCount,
  errors,
}, null, 2));
await browser.close();
