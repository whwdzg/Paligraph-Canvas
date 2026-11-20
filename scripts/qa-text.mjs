import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

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

async function textImages() {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('paligraph-canvas');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const all = request.result.transaction('notes', 'readonly').objectStore('notes').getAll();
      all.onerror = () => reject(all.error);
      all.onsuccess = () => {
        const note = all.result.sort((a, b) => b.updatedAt - a.updatedAt)[0];
        resolve((note.images ?? []).filter((image) => image.text).map((image) => ({
          id: image.id,
          text: image.text,
          width: image.width,
          height: image.height,
        })));
      };
    };
  }));
}

async function setRange(selector, value) {
  await page.locator(selector).evaluate((element, next) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(element, String(next));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.app-shell:not(.app-skeleton)');
await page.locator('.sidebar .new-note-button').click();
await page.waitForTimeout(300);
await page.locator('.hint-dismiss').click();

await page.getByRole('button', { name: '插入文字' }).click();
await page.waitForSelector('.text-modal');
await page.waitForTimeout(200);
await page.locator('.text-input').fill('字号测试\nPaligraph Canvas');
await page.locator('.text-font-select').selectOption('serif');
await setRange('.text-size-row input[type="range"]', 40);
await page.locator('.text-style-button[aria-label="粗体"]').click();
await page.waitForTimeout(150);
await page.screenshot({ path: 'screenshots/text-editor.png' });
await page.getByRole('button', { name: '插入', exact: true }).click();
await page.waitForTimeout(650);
const inserted = await textImages();

const box = await page.locator('.drawing-surface').boundingBox();
await page.locator('.tool-button[aria-label="选择"]').click();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await page.mouse.move(cx - 300, cy - 150);
await page.mouse.down();
for (const [x, y] of [[cx - 300, cy - 150], [cx + 300, cy - 150], [cx + 300, cy + 150], [cx - 300, cy + 150], [cx - 300, cy - 150]]) {
  await page.mouse.move(x, y, { steps: 4 });
}
await page.mouse.up();
await page.waitForTimeout(250);
const editAction = await page.locator('.selection-action[aria-label="编辑文字"]').count();
await page.locator('.selection-action[aria-label="编辑文字"]').click();
await page.waitForSelector('.text-modal');
await page.waitForTimeout(200);
const initial = await page.locator('.text-input').inputValue();
await page.locator('.text-font-select').selectOption('mono');
await setRange('.text-size-row input[type="range"]', 24);
await page.waitForTimeout(400);
const editPreview = await page.locator('.text-preview').evaluate((element) => ({
  size: getComputedStyle(element).fontSize,
  family: getComputedStyle(element).fontFamily,
}));
await page.getByRole('button', { name: '保存', exact: true }).click();
await page.waitForTimeout(900);
const edited = await textImages();

console.log(JSON.stringify({
  inserted,
  editAction,
  initial,
  editPreview,
  edited,
  sameId: inserted[0]?.id === edited[0]?.id,
  pass: inserted.length === 1
    && inserted[0].text.fontId === 'serif'
    && inserted[0].text.fontSize === 40
    && inserted[0].text.bold === true
    && editAction === 1
    && edited[0].text.fontId === 'mono'
    && edited[0].text.fontSize === 24
    && inserted[0].id === edited[0].id,
  errors,
}, null, 2));
await browser.close();
