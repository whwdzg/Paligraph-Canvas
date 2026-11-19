import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import path from 'node:path';

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
].filter(Boolean);
const executablePath = candidates.find((candidate) => existsSync(candidate));
if (!executablePath) throw new Error('No browser found.');

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
await page.getByRole('button', { name: '导入', exact: true }).first().click();
await page.waitForSelector('.import-modal');
const input = page.locator('.import-modal input[type=file][accept*=".md"]');
await input.setInputFiles(path.resolve('scripts/fixtures/latex.md'));
await page.waitForSelector('.import-result', { timeout: 15000 });
await page.locator('.import-modal .fluent-button.primary').click();
await page.waitForTimeout(1800);
const katex = await page.locator('.markdown-card .katex').count();
const display = await page.locator('.markdown-card .math-display').count();
const code = await page.locator('.markdown-card pre code').innerText().catch(() => '');
await page.screenshot({ path: 'screenshots/latex-import.png' });
console.log(JSON.stringify({
  katex,
  display,
  codeBlockKeptLiteral: code.includes('$E = mc^2$'),
  errors,
}, null, 2));
await browser.close();
