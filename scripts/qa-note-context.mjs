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
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' });
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
await page.waitForTimeout(350);

const card = page.locator('.note-card').first();
const box = await card.boundingBox();
await page.mouse.click(box.x + 40, box.y + 30, { button: 'right' });
await page.waitForTimeout(200);
const rightMenu = await page.locator('.note-menu.is-floating').innerText();
const rightBox = await page.locator('.note-menu.is-floating').boundingBox();
await page.locator('.note-menu-scrim').click({ position: { x: 5, y: 5 } });
await page.waitForTimeout(150);

await card.locator('..').locator('.note-menu-trigger').click();
await page.waitForTimeout(150);
const dotMenu = await page.locator('.note-menu.is-floating').innerText();

console.log(JSON.stringify({
  rightMenu,
  dotMenu,
  rightBox,
  sameItems: rightMenu === dotMenu,
  hasItems: /移动到文件夹/.test(rightMenu) && /删除笔记/.test(rightMenu),
  nearPointer: rightBox.x >= 8 && rightBox.y >= 8,
  pass: rightMenu === dotMenu && /移动到文件夹/.test(rightMenu) && /删除笔记/.test(rightMenu) && errors.length === 0,
  errors,
}, null, 2));
await browser.close();
