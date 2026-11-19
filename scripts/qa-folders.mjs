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

// Create two folders using the folder dialog.
for (const name of ['Alpha', 'Beta']) {
  await page.getByRole('button', { name: '新建文件夹' }).click();
  await page.locator('.folder-name-field input').fill(name);
  await page.getByRole('button', { name: '创建' }).click();
  await page.waitForTimeout(300);
}
const folderTree = await page.locator('.folder-tree').innerText();

// Create two notes in Alpha.
await page.locator('.folder-select').filter({ hasText: 'Alpha' }).click();
await page.waitForTimeout(250);
await page.locator('.sidebar .new-note-button').click();
await page.locator('.sidebar .new-note-button').click();
await page.waitForTimeout(400);
const alphaCards = await page.locator('.note-card').count();

// Select all Alpha notes and move them to Beta.
await page.locator('.note-select-entry').click();
await page.getByRole('button', { name: '全选' }).click();
await page.locator('.note-selection-bar .icon-button').first().click();
await page.waitForSelector('.folder-picker');
await page.locator('.folder-picker-row').filter({ hasText: 'Beta' }).click();
await page.waitForTimeout(600);
const afterMoveTree = await page.locator('.folder-tree').innerText();
const alphaAfterMove = await page.locator('.note-card').count();

// Open the three-dot menu and confirm the export entries exist.
await page.locator('.folder-select').filter({ hasText: 'Beta' }).click();
await page.waitForTimeout(300);
await page.locator('.note-menu-trigger').first().click();
await page.waitForTimeout(200);
const menuText = await page.locator('.note-menu.is-floating').innerText();
await page.screenshot({ path: 'screenshots/folder-note-menu.png' });
const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
await page.getByRole('menuitem', { name: 'Markdown' }).click();
const download = await downloadPromise;
const downloaded = download.suggestedFilename();
await page.mouse.click(800, 500);

// Select all Beta notes, delete them, and confirm.
await page.locator('.note-select-entry').click();
await page.getByRole('button', { name: '全选' }).click();
await page.locator('.note-selection-bar .icon-button.danger').click();
await page.waitForSelector('.confirm-body');
const confirmText = await page.locator('.confirm-body').innerText();
await page.locator('.modal-panel .fluent-button.danger').click();
await page.waitForTimeout(700);
const afterDeleteTree = await page.locator('.folder-tree').innerText();
const betaCount = await page.locator('.note-card').count();

console.log(JSON.stringify({
  folderTree,
  alphaCards,
  afterMoveTree,
  alphaAfterMove,
  menuHasExports: ['PDF', 'Markdown', 'PNG', 'SVG', 'Paligraph'].every((label) => menuText.includes(label)),
  menuText,
  downloaded,
  confirmText,
  afterDeleteTree,
  betaCount,
  errors,
}, null, 2));
await browser.close();
