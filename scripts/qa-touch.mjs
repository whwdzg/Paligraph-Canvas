import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Exercises the deliberate two-finger long-press gesture through CDP touch
 * events. Run against `npm run preview` on port 4173.
 */
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
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'zh-CN',
  colorScheme: 'light',
});
await context.addInitScript(() => {
  localStorage.setItem('paligraph-settings', JSON.stringify({ state: { theme: 'light', language: 'zh-CN' }, version: 1 }));
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
const client = await context.newCDPSession(page);

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.app-shell:not(.app-skeleton)');
await page.waitForTimeout(500);

// Import a markdown note so we can watch the reading card transform.
await page.getByRole('button', { name: '打开笔记列表' }).click();
await page.waitForTimeout(350);
await page.getByRole('button', { name: '导入', exact: true }).first().click();
await page.waitForSelector('.import-modal');
await page.locator('.import-modal input[accept*=".md"]').setInputFiles(path.resolve('scripts/fixtures/sample-import.md'));
await page.waitForSelector('.import-result', { timeout: 15000 });
await page.locator('.import-modal .modal-footer .primary').click();
await page.waitForTimeout(1200);

const readTransform = async () => page.locator('.markdown-card-anchor').evaluate((node) => getComputedStyle(node).transform);
const before = await readTransform();

const touch = (type, points) => client.send('Input.dispatchTouchEvent', { type, touchPoints: points });
await touch('touchStart', [
  { x: 140, y: 420, id: 1 },
  { x: 250, y: 420, id: 2 },
]);
await page.waitForTimeout(300);
await touch('touchMove', [
  { x: 170, y: 470, id: 1 },
  { x: 280, y: 470, id: 2 },
]);
await page.waitForTimeout(120);
await touch('touchEnd', []);
await page.waitForTimeout(400);
const afterPan = await readTransform();

// Pinch out after another deliberate long press.
await touch('touchStart', [
  { x: 160, y: 430, id: 3 },
  { x: 230, y: 430, id: 4 },
]);
await page.waitForTimeout(300);
await touch('touchMove', [
  { x: 105, y: 430, id: 3 },
  { x: 285, y: 430, id: 4 },
]);
await page.waitForTimeout(120);
await touch('touchEnd', []);
await page.waitForTimeout(500);
const afterZoom = await readTransform();

// Quick two-finger tap should NOT move the view and should not leave ink.
const beforeQuick = await readTransform();
await touch('touchStart', [
  { x: 150, y: 400, id: 5 },
  { x: 240, y: 400, id: 6 },
]);
await page.waitForTimeout(60);
await touch('touchEnd', []);
await page.waitForTimeout(300);
const afterQuick = await readTransform();

await page.screenshot({ path: 'screenshots/mobile-imported.png' });

console.log(JSON.stringify({
  before,
  afterPan,
  afterZoom,
  quickGestureUnchanged: beforeQuick === afterQuick,
  errors,
}, null, 2));
await browser.close();
