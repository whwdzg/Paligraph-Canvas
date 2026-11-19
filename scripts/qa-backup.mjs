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

await page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open('paligraph-canvas');
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result;
    const tx = db.transaction('notes', 'readwrite');
    const now = Date.now();
    const strokes = Array.from({ length: 101 }, (_, index) => ({
      id: `backup-${index}`,
      tool: 'pen',
      variant: 'pen',
      color: '#1f6feb',
      size: 4,
      opacity: 1,
      points: [
        { x: 100 + (index % 20) * 30, y: 120 + Math.floor(index / 20) * 50, p: 0.5 },
        { x: 120 + (index % 20) * 30, y: 130 + Math.floor(index / 20) * 50, p: 0.5 },
      ],
      seed: index,
      createdAt: now,
    }));
    tx.objectStore('notes').put({
      id: 'backup-note',
      title: '100+ strokes',
      markdown: '',
      strokes,
      images: [],
      background: { pattern: 'grid', lineStyle: 'solid', spacing: 32, opacity: 0.14, color: '' },
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1,
    });
    tx.oncomplete = () => {
      localStorage.setItem('paligraph-active-note', 'backup-note');
      resolve(true);
    };
    tx.onerror = () => reject(tx.error);
  };
}));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.app-shell:not(.app-skeleton)');
await page.waitForTimeout(700);
const toast = await page.locator('.toast').last().innerText().catch(() => null);
const chip = await page.locator('.backup-chip').innerText().catch(() => null);
await page.screenshot({ path: 'screenshots/backup-reminder.png' });
const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
await page.locator('.backup-chip').click();
const download = await downloadPromise;
console.log(JSON.stringify({
  toast,
  chip,
  file: download.suggestedFilename(),
  errors,
}, null, 2));
await browser.close();
