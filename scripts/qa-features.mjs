import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
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
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  locale: 'zh-CN',
  colorScheme: 'light',
  acceptDownloads: true,
});
await context.addInitScript(() => {
  localStorage.setItem('paligraph-settings', JSON.stringify({ state: { theme: 'light', language: 'zh-CN' }, version: 1 }));
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.app-shell:not(.app-skeleton)');

const check = async (name, fn) => {
  try {
    const result = await fn();
    console.log('OK', name, result ?? '');
    return result;
  } catch (error) {
    console.log('FAIL', name, error.message);
    throw error;
  }
};

await check('new blank note', async () => {
  await page.locator('.sidebar .new-note-button').click();
  await page.waitForTimeout(450);
  const hint = await page.locator('.empty-canvas-hint').count();
  await page.screenshot({ path: 'screenshots/blank-note.png' });
  return { hint };
});

await check('highlighter straight stroke', async () => {
  await page.getByRole('button', { name: '荧光笔' }).click();
  await page.waitForSelector('.tool-options');
  await page.getByRole('radio', { name: '直线' }).click();
  await page.locator('.tool-options .icon-button').click();
  const box = await page.locator('.drawing-surface').boundingBox();
  await page.mouse.move(box.x + 420, box.y + 190);
  await page.mouse.down();
  await page.mouse.move(box.x + 760, box.y + 210, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const excerpt = await page.locator('.note-card.is-active .note-card-excerpt').textContent();
  return { excerpt };
});

await check('stroke eraser tap', async () => {
  await page.getByRole('button', { name: '橡皮' }).click();
  await page.waitForSelector('.tool-options');
  await page.getByRole('button', { name: /按笔迹擦/ }).click();
  await page.locator('.tool-options .icon-button').click();
  const box = await page.locator('.drawing-surface').boundingBox();
  await page.mouse.move(box.x + 580, box.y + 200);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(450);
  const excerpt = await page.locator('.note-card.is-active .note-card-excerpt').textContent();
  return { excerpt };
});

await check('draw and select, copy and paste', async () => {
  await page.getByRole('button', { name: '钢笔' }).click();
  await page.locator('.tool-options .icon-button').click();
  const box = await page.locator('.drawing-surface').boundingBox();
  await page.mouse.move(box.x + 350, box.y + 400);
  await page.mouse.down();
  await page.mouse.move(box.x + 650, box.y + 470, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(350);
  await page.getByRole('button', { name: '选择' }).click();
  await page.mouse.move(box.x + 300, box.y + 350);
  await page.mouse.down();
  for (const [x, y] of [[300, 350], [720, 350], [720, 520], [300, 520]]) {
    await page.mouse.move(box.x + x, box.y + y, { steps: 5 });
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  const selected = await page.locator('.selection-count').textContent();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(350);
  const excerpt = await page.locator('.note-card.is-active .note-card-excerpt').textContent();
  await page.screenshot({ path: 'screenshots/selection-copy.png' });
  return { selected, excerpt };
});

await check('settings data download', async () => {
  await page.getByRole('button', { name: '设置' }).click();
  await page.waitForSelector('.settings-modal');
  await page.getByRole('tab', { name: '数据与备份' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 JSON' }).click();
  const download = await downloadPromise;
  const target = path.resolve('screenshots', await download.suggestedFilename());
  await download.saveAs(target);
  const raw = await readFile(target, 'utf8');
  const parsed = JSON.parse(raw);
  await page.screenshot({ path: 'screenshots/settings-data.png' });
  return { version: parsed.version, hasLanguage: Boolean(parsed.settings.language) };
});

await check('switch language to Japanese', async () => {
  await page.getByRole('tab', { name: '语言' }).click();
  await page.getByRole('radio', { name: /日本語/ }).click();
  await page.waitForTimeout(600);
  const newNote = await page.locator('.new-note-button').textContent();
  await page.screenshot({ path: 'screenshots/settings-japanese.png' });
  return { newNote: newNote?.trim() };
});

await check('export markdown for canvas note', async () => {
  await page.getByRole('button', { name: '完了' }).click().catch(async () => {
    await page.getByRole('button', { name: '完成' }).click();
  });
  await page.waitForTimeout(300);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '書き出し' }).click();
  await page.getByRole('menuitem', { name: /Markdown/ }).click();
  const download = await downloadPromise;
  const target = path.resolve('screenshots', await download.suggestedFilename());
  await download.saveAs(target);
  const content = await readFile(target, 'utf8');
  return { contentStarts: content.slice(0, 80), hasInkHeading: content.includes('インクの注釈') };
});

console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
