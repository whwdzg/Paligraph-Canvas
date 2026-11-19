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
const sw = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.ready;
  return { scope: registration.scope, controller: Boolean(navigator.serviceWorker.controller) };
});
const manifest = await page.evaluate(async () => {
  const response = await fetch('/manifest.webmanifest');
  const value = await response.json();
  return { display: value.display, icons: value.icons?.length ?? 0, startUrl: value.start_url };
});
await page.reload({ waitUntil: 'networkidle' });
const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));

await page.evaluate(() => {
  const event = new Event('beforeinstallprompt');
  Object.defineProperties(event, {
    prompt: { value: async () => { window.__prompted = true; } },
    userChoice: { value: Promise.resolve({ outcome: 'accepted', platform: 'web' }) },
  });
  window.dispatchEvent(event);
});
await page.waitForSelector('.pwa-sidebar-card');
const promptText = await page.locator('.pwa-sidebar-card').innerText();
await page.locator('.pwa-prompt-action').click();
await page.waitForTimeout(400);
const prompted = await page.evaluate(() => Boolean(window.__prompted));
const bannerAfter = await page.locator('.pwa-sidebar-card').count();

await page.getByRole('button', { name: '设置' }).click();
await page.getByRole('tab', { name: '关于' }).click();
await page.waitForTimeout(250);
const installCard = await page.locator('.pwa-settings-card').innerText();

await context.setOffline(true);
let offline = false;
try {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('.app-shell:not(.app-skeleton)', { timeout: 15000 });
  offline = true;
} catch {
  offline = false;
}
await context.setOffline(false);

console.log(JSON.stringify({
  sw,
  controlled,
  manifest,
  promptText,
  prompted,
  bannerAfter,
  installCard,
  offline,
  errors,
}, null, 2));
await browser.close();
