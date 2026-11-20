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

async function recognize(draw) {
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
  await page.locator('.sidebar .new-note-button').click();
  await page.waitForTimeout(300);
  await page.locator('.hint-dismiss').click();
  const box = await page.locator('.drawing-surface').boundingBox();
  if (!box) throw new Error('No canvas.');
  const stroke = async (points) => {
    await page.mouse.move(box.x + points[0][0], box.y + points[0][1]);
    await page.mouse.down();
    for (const [x, y] of points.slice(1)) {
      await page.mouse.move(box.x + x, box.y + y, { steps: 8 });
    }
    await page.mouse.up();
    await page.waitForTimeout(70);
  };
  await draw(stroke);
  await page.waitForTimeout(250);
  await page.locator('.tool-button[aria-label="选择"]').click();
  await page.mouse.move(box.x + 230, box.y + 130);
  await page.mouse.down();
  for (const [x, y] of [[230, 130], [760, 130], [760, 350], [230, 350], [230, 130]]) {
    await page.mouse.move(box.x + x, box.y + y, { steps: 5 });
  }
  await page.mouse.up();
  await page.waitForTimeout(250);
  await page.locator('.selection-action.is-math').click();
  await page.waitForSelector('.math-modal');
  await page.waitForTimeout(250);
  const expression = await page.locator('#math-expression').inputValue();
  const glyphs = await page.locator('.math-glyph').allTextContents();
  await context.close();
  return { expression, glyphs, errors };
}

const xPlusY = await recognize(async (stroke) => {
  await stroke([[300, 180], [360, 260]]);
  await stroke([[360, 180], [300, 260]]);
  await stroke([[430, 220], [490, 220]]);
  await stroke([[460, 190], [460, 250]]);
  await stroke([[510, 180], [560, 255], [620, 180]]);
  await stroke([[560, 255], [545, 320]]);
});

const aPlusN = await recognize(async (stroke) => {
  await stroke([[300, 190], [280, 200], [278, 218], [295, 230], [315, 220], [318, 200], [300, 190], [322, 228]]);
  await stroke([[400, 225], [440, 225]]);
  await stroke([[420, 205], [420, 245]]);
  await stroke([[480, 195], [480, 240]]);
  await stroke([[480, 205], [500, 188], [520, 205], [520, 240]]);
});

console.log(JSON.stringify({
  xPlusY: xPlusY.expression,
  xPlusYGlyphs: xPlusY.glyphs,
  aPlusN: aPlusN.expression,
  aPlusNGlyphs: aPlusN.glyphs,
  pass: xPlusY.expression === 'x+y' && aPlusN.expression === 'a+n',
  errors: [...xPlusY.errors, ...aPlusN.errors],
}, null, 2));
await browser.close();
