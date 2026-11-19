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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', colorScheme: 'light' });
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
await page.waitForTimeout(300);

await page.locator('.tool-shapes').click();
await page.waitForSelector('.shape-picker');
const shapeCount = await page.locator('.shape-picker-item').count();
await page.screenshot({ path: 'screenshots/shape-picker.png' });
await page.locator('.shape-picker-item[aria-label="五角星"]').click();
await page.waitForTimeout(1200);
const selectedAfterInsert = await page.locator('.selection-toolbar').count();
await page.screenshot({ path: 'screenshots/shape-inserted-star.png' });

const inserted = await page.evaluate(() => new Promise((resolve, reject) => {
  const activeId = localStorage.getItem('paligraph-active-note');
  const request = indexedDB.open('paligraph-canvas');
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result;
    const tx = db.transaction('notes', 'readonly');
    const all = tx.objectStore('notes').getAll();
    all.onsuccess = () => {
      const note = all.result.find((item) => item.id === activeId);
      resolve(note?.strokes?.map((stroke) => stroke.shape).filter(Boolean) ?? []);
    };
  };
}));

await page.getByRole('button', { name: '背景' }).click();
await page.waitForSelector('.background-panel');
await page.locator('.pattern-axes').click();
await page.waitForTimeout(500);
await page.screenshot({ path: 'screenshots/axes-background.png' });
const axesHint = await page.locator('.background-hint').textContent().catch(() => null);
const axesChecked = await page.locator('.pattern-axes').getAttribute('aria-checked');

console.log(JSON.stringify({
  shapeCount,
  selectedAfterInsert,
  inserted,
  axesHint,
  axesChecked,
  errors,
}, null, 2));
await browser.close();
