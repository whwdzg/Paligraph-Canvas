import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
].filter(Boolean);
const executablePath = candidates.find((candidate) => existsSync(candidate));
if (!executablePath) throw new Error('No Chrome/Edge found.');

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
const logs = [];
page.on('console', (message) => {
  if (['error', 'warning'].includes(message.type())) logs.push(`${message.type()}: ${message.text()}`);
});
page.on('pageerror', (error) => logs.push(`pageerror: ${error.message}`));

const step = async (name, action) => {
  try {
    await action();
    console.log(`OK ${name}`);
  } catch (error) {
    console.log(`FAIL ${name}: ${error.message}`);
    throw error;
  }
};

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.app-shell:not(.app-skeleton)');
await page.waitForTimeout(500);

await step('open pen options', async () => {
  await page.locator('.tools-main .tool-button').first().click();
  await page.waitForSelector('.tool-options');
});
await page.screenshot({ path: 'screenshots/pen-options.png' });

await step('close pen options', async () => {
  await page.locator('.tool-options .icon-button').click();
  await page.waitForTimeout(250);
});

await step('draw a stroke', async () => {
  const surface = page.locator('.drawing-surface');
  const box = await surface.boundingBox();
  await page.mouse.move(box.x + 300, box.y + 170);
  await page.mouse.down();
  for (let i = 0; i <= 18; i += 1) {
    await page.mouse.move(box.x + 300 + i * 18, box.y + 170 + Math.sin(i / 3) * 32);
    await page.waitForTimeout(8);
  }
  await page.mouse.up();
  await page.waitForTimeout(500);
});
await page.screenshot({ path: 'screenshots/after-draw.png' });
console.log('undo enabled:', await page.locator('.history-tools button').first().isEnabled());
await page.waitForTimeout(800);

await step('lasso selection', async () => {
  await page.locator('.tool-button[aria-label="选择"]').click();
  const box = await page.locator('.drawing-surface').boundingBox();
  await page.mouse.move(box.x + 220, box.y + 95);
  await page.mouse.down();
  const points = [
    [210, 85], [850, 85], [980, 150], [1000, 650], [700, 730], [260, 720], [200, 480], [230, 170],
  ];
  for (const [x, y] of points) {
    await page.mouse.move(box.x + x, box.y + y, { steps: 5 });
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(500);
});
await page.screenshot({ path: 'screenshots/selection.png' });
console.log('selection visible:', await page.locator('.selection-toolbar').count());

await step('move selection', async () => {
  const box = await page.locator('.drawing-surface').boundingBox();
  await page.mouse.move(box.x + 500, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 570, box.y + 330, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
});
await page.screenshot({ path: 'screenshots/selection-moved.png' });

await step('rotate selection', async () => {
  await page.locator('.selection-action').nth(2).click();
  await page.waitForTimeout(350);
});
await page.screenshot({ path: 'screenshots/selection-rotated.png' });

await step('undo stroke and selection edits', async () => {
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
});

await step('open background', async () => {
  await page.getByRole('button', { name: '画布背景' }).click();
  await page.waitForSelector('.background-panel');
});
await page.screenshot({ path: 'screenshots/background-panel.png' });
await page.getByRole('button', { name: '关闭' }).first().click();

await step('open settings and switch dark', async () => {
  await page.getByRole('button', { name: '设置' }).click();
  await page.waitForSelector('.settings-modal');
  await page.getByRole('radio', { name: '深色' }).click();
  await page.waitForTimeout(400);
});
await page.screenshot({ path: 'screenshots/settings-dark.png' });
await page.getByRole('button', { name: '完成' }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: 'screenshots/home-dark.png' });

await step('import markdown', async () => {
  await page.getByRole('button', { name: '导入', exact: true }).first().click();
  await page.waitForSelector('.import-modal');
  const input = page.locator('.import-modal input[accept*=".md"]');
  await input.setInputFiles(path.resolve('scripts/fixtures/sample-import.md'));
  await page.waitForSelector('.import-result', { timeout: 15000 });
});
await page.screenshot({ path: 'screenshots/import-ready.png' });
await page.locator('.import-modal .modal-footer .primary').click();
await page.waitForTimeout(1200);
await page.screenshot({ path: 'screenshots/markdown-card.png' });

await step('open source panel', async () => {
  await page.getByRole('button', { name: 'Markdown 源文' }).click();
  await page.waitForSelector('.source-panel');
  await page.waitForTimeout(300);
});
await page.screenshot({ path: 'screenshots/source-panel.png' });
await page.locator('.source-header .icon-button').click();
await page.waitForTimeout(350);

await step('export PDF', async () => {
  await page.getByRole('button', { name: '导出' }).click();
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await page.getByRole('menuitem', { name: /PDF/ }).click();
  const download = await downloadPromise;
  const filename = await download.suggestedFilename();
  await download.saveAs(path.resolve('screenshots', filename));
  console.log('downloaded', filename);
});
await page.waitForTimeout(700);

// Mobile layout
const mobile = await context.newPage();
await mobile.setViewportSize({ width: 390, height: 844 });
await mobile.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await mobile.waitForSelector('.app-shell:not(.app-skeleton)');
await mobile.waitForTimeout(500);
await mobile.screenshot({ path: 'screenshots/mobile-light.png' });
await mobile.getByRole('button', { name: '打开笔记列表' }).click();
await mobile.waitForTimeout(300);
await mobile.screenshot({ path: 'screenshots/mobile-sidebar.png' });

console.log(JSON.stringify({ errors: logs }, null, 2));
await browser.close();
