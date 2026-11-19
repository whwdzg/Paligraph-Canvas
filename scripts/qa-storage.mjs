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
await page.getByRole('button', { name: '设置' }).click();
await page.getByRole('tab', { name: '数据' }).click();
await page.waitForSelector('.storage-card');
await page.waitForTimeout(800);
const text = await page.locator('.storage-card').innerText();
const ariaValue = await page.locator('.storage-meter').getAttribute('aria-valuenow');
await page.getByRole('button', { name: '刷新存储占用' }).click();
await page.waitForTimeout(500);
const refreshed = await page.locator('.storage-card').innerText();
await page.screenshot({ path: 'screenshots/settings-storage.png' });
console.log(JSON.stringify({
  hasNoteBreakdown: text.includes('全部笔记数据') && text.includes('笔迹') && text.includes('画布图片'),
  hasQuota: text.includes('配额') || text.includes('未提供配额'),
  ariaValue,
  refreshed: refreshed.length > 0,
  errors,
}, null, 2));
await browser.close();
