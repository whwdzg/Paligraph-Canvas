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
const surface = page.locator('.drawing-surface');
const box = await surface.boundingBox();

async function drawPath(points, holdMs = 0) {
  await page.mouse.move(box.x + points[0][0], box.y + points[0][1]);
  await page.mouse.down();
  for (let i = 1; i < points.length; i += 1) {
    await page.mouse.move(box.x + points[i][0], box.y + points[i][1], { steps: 4 });
    await page.waitForTimeout(10);
  }
  if (holdMs) await page.waitForTimeout(holdMs);
  await page.mouse.up();
  await page.waitForTimeout(180);
}

async function strokePath(points) {
  await page.mouse.move(box.x + points[0][0], box.y + points[0][1]);
  await page.mouse.down();
  for (let i = 1; i < points.length; i += 1) {
    await page.mouse.move(box.x + points[i][0], box.y + points[i][1], { steps: 3 });
    await page.waitForTimeout(12);
  }
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function latestStrokes() {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('paligraph-canvas');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('notes', 'readonly');
      const all = tx.objectStore('notes').getAll();
      all.onsuccess = () => {
        const notes = all.result.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(notes[0]?.strokes?.map((stroke) => ({ shape: stroke.shape, points: stroke.points.length })) ?? []);
      };
    };
  }));
}

await page.locator('.sidebar .new-note-button').click();
await page.waitForTimeout(350);

// A deliberately wobbly rectangle, then hold still.
const rect = [
  [300, 160], [430, 155], [432, 260], [300, 266], [302, 165],
];
await page.mouse.move(box.x + rect[0][0], box.y + rect[0][1]);
await page.mouse.down();
for (let i = 1; i < rect.length; i += 1) {
  await page.mouse.move(box.x + rect[i][0], box.y + rect[i][1], { steps: 8 });
  await page.waitForTimeout(12);
}
await page.waitForTimeout(820);
const shapeHint = await page.locator('.shape-hint').count();
const shapeText = shapeHint ? await page.locator('.shape-hint').textContent() : '';
await page.screenshot({ path: 'screenshots/shape-hold.png' });
await page.mouse.up();
await page.waitForTimeout(1100);
const strokesAfterShape = await latestStrokes();
await page.screenshot({ path: 'screenshots/shape-snapped.png' });

// Create a fresh note for the math capture.
await page.locator('.sidebar .new-note-button').click();
await page.waitForTimeout(350);
// 2 + 3 = 5, one stroke per digit / symbol where possible.
await strokePath([[300, 160], [330, 150], [344, 166], [330, 185], [302, 211], [346, 211]]);
await strokePath([[372, 186], [412, 186]]);
await strokePath([[392, 167], [392, 205]]);
await strokePath([[442, 158], [470, 164], [451, 185], [472, 191], [469, 208], [440, 213]]);
await strokePath([[500, 181], [542, 181]]);
await strokePath([[500, 197], [542, 197]]);
await strokePath([[574, 160], [610, 160], [609, 177], [588, 179], [580, 200], [603, 207], [602, 215], [573, 211]]);
await page.waitForTimeout(450);
await page.screenshot({ path: 'screenshots/math-handwriting.png' });

// Select all handwritten math with the lasso, then use the floating math action.
await page.locator('.tool-button[aria-label="选择"]').click();
await page.mouse.move(box.x + 270, box.y + 130);
await page.mouse.down();
for (const [x, y] of [[270, 130], [660, 120], [670, 240], [270, 250], [270, 130]]) {
  await page.mouse.move(box.x + x, box.y + y, { steps: 4 });
  await page.waitForTimeout(12);
}
await page.mouse.up();
await page.waitForTimeout(450);
await page.screenshot({ path: 'screenshots/math-selection.png' });
const selectionToolbar = await page.locator('.selection-toolbar').count();
await page.locator('.selection-action.is-math').click();
let modalVisible = 0;
try {
  await page.waitForSelector('.math-modal', { timeout: 5000 });
  modalVisible = 1;
} catch {
  modalVisible = 0;
}
if (modalVisible) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'screenshots/math-dialog-auto.png' });
  const recognized = await page.locator('#math-expression').inputValue().catch(() => '');
  await page.locator('#math-expression').fill('2 + 3 = 5');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'screenshots/math-dialog-simple.png' });
  await page.locator('#math-expression').fill('2x + 3 = 7');
  await page.waitForTimeout(300);
  const equationAnswer = await page.locator('.math-answer > strong').textContent().catch(() => '');
  await page.screenshot({ path: 'screenshots/math-dialog-equation.png' });

  await page.locator('#math-expression').fill('x + y = 5; x - y = 1');
  await page.waitForTimeout(300);
  const systemAnswer = await page.locator('.math-answer > strong').textContent().catch(() => '');
  await page.screenshot({ path: 'screenshots/math-dialog-system.png' });

  await page.locator('#math-expression').fill('d/dx(x^3 + 2x)');
  await page.waitForTimeout(300);
  const derivativeAnswer = await page.locator('.math-answer > strong').textContent().catch(() => '');

  await page.locator('#math-expression').fill('sum(n^2, n=1..10)');
  await page.waitForTimeout(300);
  const sumAnswer = await page.locator('.math-answer > strong').textContent().catch(() => '');
  await page.screenshot({ path: 'screenshots/math-dialog-advanced.png' });

  await page.locator('#math-expression').fill('23 + 45');
  await page.waitForTimeout(250);
  const columnTab = page.getByRole('radio', { name: '竖式' });
  if (await columnTab.count()) await columnTab.click();
  await page.waitForTimeout(300);
  const columnAnswer = await page.locator('.math-answer > strong').textContent().catch(() => '');
  const columnWorking = await page.locator('.vertical-work').count();
  await page.screenshot({ path: 'screenshots/math-dialog-column.png' });
  console.log(JSON.stringify({ shapeHint, shapeText: shapeText?.trim(), strokesAfterShape, selectionToolbar, modalVisible, recognized, equationAnswer, systemAnswer, derivativeAnswer, sumAnswer, columnAnswer, columnWorking, errors }, null, 2));
} else {
  console.log(JSON.stringify({ shapeHint, shapeText: shapeText?.trim(), strokesAfterShape, selectionToolbar, modalVisible, errors }, null, 2));
}
await browser.close();
