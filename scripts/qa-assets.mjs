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
  localStorage.setItem('paligraph-settings', JSON.stringify({ state: { theme: 'dark', language: 'zh-CN' }, version: 1 }));
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.app-shell:not(.app-skeleton)');
await page.getByRole('button', { name: '导入', exact: true }).first().click();
await page.waitForSelector('.import-modal');
const folderInput = page.locator('.import-modal input[type="file"]').nth(1);
await folderInput.setInputFiles(path.resolve('scripts/fixtures/vault'));
await page.waitForSelector('.import-result', { timeout: 15000 });
await page.screenshot({ path: 'screenshots/asset-import-ready.png' });
await page.locator('.import-modal .modal-footer .primary').click();
await page.waitForTimeout(1500);
const image = page.locator('.markdown-card img');
const src = await image.getAttribute('src').catch(() => null);
const callout = await page.locator('.markdown-card blockquote').count();
await page.screenshot({ path: 'screenshots/asset-import-card.png' });
await image.click();
await page.waitForTimeout(350);
const lightbox = await page.locator('.image-lightbox').count();
await page.screenshot({ path: 'screenshots/asset-lightbox.png' });
console.log(JSON.stringify({
  inlineImage: Boolean(src?.startsWith('data:image/png')),
  callout,
  lightbox,
  errors,
}, null, 2));
await browser.close();
