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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', acceptDownloads: true });
await context.addInitScript(() => {
  localStorage.setItem('paligraph-settings', JSON.stringify({ state: { theme: 'light', language: 'zh-CN' }, version: 1 }));
});
const page = await context.newPage();
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.app-shell:not(.app-skeleton)');
await page.getByRole('button', { name: '导入', exact: true }).first().click();
await page.waitForSelector('.import-modal');
await page.locator('.import-modal input[accept*=".md"]').setInputFiles(path.resolve('scripts/fixtures/chinese-note.md'));
await page.waitForSelector('.import-result');
await page.locator('.import-modal .modal-footer .primary').click();
await page.waitForTimeout(1000);

// Draw an underline across the reading card to exercise a combined text+ink PDF.
const surface = page.locator('.drawing-surface');
const box = await surface.boundingBox();
await page.mouse.move(box.x + 520, box.y + 260);
await page.mouse.down();
await page.mouse.move(box.x + 900, box.y + 268, { steps: 18 });
await page.mouse.up();
await page.waitForTimeout(500);

const downloadPromise = page.waitForEvent('download', { timeout: 45000 });
await page.getByRole('button', { name: '导出' }).click();
await page.getByRole('menuitem', { name: /PDF/ }).click();
const download = await downloadPromise;
const target = path.resolve('screenshots', await download.suggestedFilename());
await download.saveAs(target);
console.log(target);
await browser.close();
