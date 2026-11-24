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

async function strokes() {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('paligraph-canvas');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const all = request.result.transaction('notes', 'readonly').objectStore('notes').getAll();
      all.onerror = () => reject(all.error);
      all.onsuccess = () => {
        const note = all.result.sort((a, b) => b.updatedAt - a.updatedAt)[0];
        resolve(note.strokes.filter((stroke) => stroke.tool === 'pen').map((stroke) => {
          const pressures = stroke.points.map((point) => point.p);
          return {
            count: pressures.length,
            min: Math.min(...pressures),
            max: Math.max(...pressures),
            avg: pressures.reduce((sum, value) => sum + value, 0) / pressures.length,
          };
        }));
      };
    };
  }));
}

async function setRange(name, value) {
  await page.getByRole('slider', { name }).evaluate((element, next) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(element, String(next));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function openAppearance() {
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByRole('tab', { name: '外观' }).click();
  await page.waitForTimeout(200);
}

async function closeSettings() {
  await page.locator('.modal-panel .modal-header .icon-button').click();
  await page.waitForTimeout(200);
}

async function drawStroke(y, slow) {
  const box = await page.locator('.drawing-surface').boundingBox();
  await page.mouse.move(box.x + 300, box.y + y);
  await page.mouse.down();
  if (slow) {
    for (let index = 1; index <= 30; index += 1) {
      await page.mouse.move(box.x + 300 + index * 10, box.y + y);
      await page.waitForTimeout(25);
    }
  } else {
    for (let index = 1; index <= 8; index += 1) {
      await page.mouse.move(box.x + 300 + index * 37.5, box.y + y);
    }
  }
  await page.mouse.up();
  await page.waitForTimeout(700);
}

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.app-shell:not(.app-skeleton)');
await page.locator('.sidebar .new-note-button').click();
await page.waitForTimeout(300);
await page.locator('.hint-dismiss').click();

await openAppearance();
const strengthSlider = await page.getByRole('slider', { name: '压感强度' }).count();
const sensitivitySlider = await page.getByRole('slider', { name: '压感灵敏度' }).count();
const algorithmSwitch = await page.getByRole('switch', { name: '压感算法' }).count();
await setRange('压感强度', 1.5);
await page.waitForTimeout(150);
const strengthDisplay = await page.locator('.slider-field', { hasText: '压感强度' }).locator('.slider-value').textContent();
await page.getByRole('switch', { name: '压感算法' }).click();
await page.waitForTimeout(150);
const storedOff = await page.evaluate(() => JSON.parse(localStorage.getItem('paligraph-settings')).state);
await closeSettings();
await drawStroke(220, true);
const algorithmOff = await strokes();

await openAppearance();
await page.getByRole('switch', { name: '压感算法' }).click();
await page.waitForTimeout(150);
await closeSettings();
await drawStroke(300, true);
await drawStroke(400, false);
const all = await strokes();
const slow = all[all.length - 2];
const fast = all[all.length - 1];

console.log(JSON.stringify({
  controls: { strengthSlider, sensitivitySlider, algorithmSwitch },
  strengthDisplay,
  storedOff: { strength: storedOff.pressureStrength, algorithm: storedOff.pressureAlgorithm },
  algorithmOff,
  slow,
  fast,
  pass: strengthSlider === 1
    && sensitivitySlider === 1
    && algorithmSwitch === 1
    && strengthDisplay?.includes('150')
    && storedOff.pressureStrength === 1.5
    && storedOff.pressureAlgorithm === false
    && algorithmOff.every((stroke) => Math.abs(stroke.avg - 0.5) < 0.001)
    && slow.avg > fast.avg + 0.08,
  errors,
}, null, 2));
await browser.close();
