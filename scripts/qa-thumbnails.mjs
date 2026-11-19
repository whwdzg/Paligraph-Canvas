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

async function importFrom(pathToFile, expectedTitle, folder = false) {
  await page.getByRole('button', { name: '导入', exact: true }).first().click();
  await page.waitForSelector('.import-modal');
  const input = folder
    ? page.locator('.import-modal input[type="file"]').nth(1)
    : page.locator('.import-modal input[accept*=".md"]');
  await input.setInputFiles(pathToFile);
  await page.waitForSelector('.import-result');
  await page.locator('.import-modal .modal-footer .primary').click();
  await page.waitForTimeout(1800);
  const card = page.locator('.note-card', { hasText: expectedTitle }).first();
  const thumb = card.locator('img.note-thumb');
  const src = await thumb.getAttribute('src').catch(() => null);
  const box = await thumb.boundingBox().catch(() => null);
  return { src: src?.slice(0, 32), hasData: Boolean(src?.startsWith('data:image/')), box };
}

const withImage = await importFrom(path.resolve('scripts/fixtures/vault'), 'A vault note', true);
await page.screenshot({ path: 'screenshots/preview-import-image.png' });

const plain = await importFrom(path.resolve('scripts/fixtures/sample-import.md'), 'Designing a quiet workspace');
await page.screenshot({ path: 'screenshots/preview-import-markdown.png' });

console.log(JSON.stringify({ withImage, plain, errors }, null, 2));
await browser.close();
