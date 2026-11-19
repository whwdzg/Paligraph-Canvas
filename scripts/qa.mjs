import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

/**
 * Local visual smoke test. Requires `npm run preview` on port 4173 and a
 * Chrome/Edge installation (playwright-core does not download a browser).
 */
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const executablePath = candidates.find((candidate) => existsSync(candidate));
if (!executablePath) throw new Error('No browser found. Set CHROME_PATH.');

await mkdir('screenshots', { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  locale: 'zh-CN',
  colorScheme: 'light',
});
const page = await context.newPage();
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.app-shell:not(.app-skeleton)', { timeout: 15000 });
await page.waitForTimeout(800);
await page.screenshot({ path: 'screenshots/home-light.png', fullPage: false });

const title = await page.locator('.note-title-input').inputValue().catch(() => null);
const canvas = await page.locator('.drawing-surface').count();
const errorsText = await page.locator('.fatal-screen').count();

console.log(JSON.stringify({ title, canvas, fatal: errorsText, errors }, null, 2));
await browser.close();
