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

async function sample(selector, x, y) {
  return page.evaluate(({ selector, x, y }) => {
    const canvas = document.querySelector(selector);
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    const sx = Math.round((x - rect.left) * canvas.width / rect.width);
    const sy = Math.round((y - rect.top) * canvas.height / rect.height);
    return Array.from(ctx.getImageData(sx, sy, 1, 1).data);
  }, { selector, x, y });
}

async function chooseColor(color) {
  await page.locator('.tools-main .tool-button').first().click();
  await page.locator(`.color-swatch[aria-label="${color}"]`).click();
  await page.locator('.tool-options .icon-button').click();
  await page.waitForTimeout(150);
}

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.app-shell:not(.app-skeleton)');
await page.locator('.sidebar .new-note-button').click();
await page.waitForTimeout(300);
await page.locator('.hint-dismiss').click();
const box = await page.locator('.drawing-surface').boundingBox();

await chooseColor('#d75a4a');
await page.mouse.move(box.x + 350, box.y + 300);
await page.mouse.down();
await page.mouse.move(box.x + 700, box.y + 300, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(500);

await chooseColor('#1f6feb');
await page.mouse.move(box.x + 525, box.y + 200);
await page.mouse.down();
await page.mouse.move(box.x + 525, box.y + 300, { steps: 8 });
await page.waitForTimeout(120);
const liveOverlap = await sample('.canvas-live', box.x + 525, box.y + 300);
await page.mouse.move(box.x + 525, box.y + 400, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(600);

const inkOverlap = await sample('.canvas-ink', box.x + 525, box.y + 300);
const red = await sample('.canvas-ink', box.x + 400, box.y + 300);
const blue = await sample('.canvas-ink', box.x + 525, box.y + 220);
const channelDelta = liveOverlap && inkOverlap
  ? Math.max(...liveOverlap.slice(0, 3).map((value, index) => Math.abs(value - inkOverlap[index])))
  : 999;

console.log(JSON.stringify({
  red,
  blue,
  liveOverlap,
  inkOverlap,
  channelDelta,
  pass: red?.[3] > 240
    && blue?.[3] > 240
    && inkOverlap?.[3] > 240
    && inkOverlap[0] < red[0] * 0.7
    && inkOverlap[2] > blue[2] * 0.15
    && channelDelta <= 5,
  errors,
}, null, 2));
await browser.close();
