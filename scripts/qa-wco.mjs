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
  Object.defineProperty(navigator, 'windowControlsOverlay', {
    configurable: true,
    value: {
      visible: true,
      getTitlebarAreaRect: () => ({ x: 0, y: 0, width: 1142, height: 40 }),
      addEventListener() {},
      removeEventListener() {},
    },
  });
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.app-shell:not(.app-skeleton)');
await page.waitForTimeout(350);

const state = await page.evaluate(() => {
  const shell = document.querySelector('.app-shell');
  const header = document.querySelector('.editor-header');
  const button = header?.querySelector('button');
  const sidebar = document.querySelector('.sidebar');
  const actions = header?.querySelector('.editor-actions');
  const headerStyle = header ? getComputedStyle(header) : null;
  return {
    className: shell?.className ?? '',
    shellPaddingTop: shell ? getComputedStyle(shell).paddingTop : '',
    headerPosition: headerStyle?.position ?? '',
    headerHeight: headerStyle?.height ?? '',
    headerTop: headerStyle?.top ?? '',
    headerPaddingRight: headerStyle?.paddingRight ?? '',
    headerPaddingLeft: headerStyle?.paddingLeft ?? '',
    headerRegion: headerStyle?.getPropertyValue('app-region') || headerStyle?.getPropertyValue('-webkit-app-region') || '',
    buttonRegion: button
      ? getComputedStyle(button).getPropertyValue('app-region') || getComputedStyle(button).getPropertyValue('-webkit-app-region') || ''
      : '',
    sidebarTop: sidebar?.getBoundingClientRect().top ?? 0,
    actionsRight: actions?.getBoundingClientRect().right ?? 0,
    viewport: window.innerWidth,
    controlsWidth: getComputedStyle(document.documentElement).getPropertyValue('--wco-controls-width').trim(),
  };
});
const manifest = await page.evaluate(async () => {
  const value = await (await fetch('./manifest.webmanifest')).json();
  return value.display_override ?? [];
});
await page.screenshot({ path: 'screenshots/wco.png' });

const normalContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' });
const normalPage = await normalContext.newPage();
await normalPage.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await normalPage.waitForSelector('.app-shell:not(.app-skeleton)');
const normalClass = await normalPage.locator('.app-shell').getAttribute('class');

const headerHeight = Number.parseFloat(state.headerHeight);
const controlsStart = state.viewport - Number.parseFloat(state.controlsWidth || '0');
console.log(JSON.stringify({
  state,
  manifest,
  normalClass,
  pass: manifest[0] === 'window-controls-overlay'
    && state.className.includes('is-wco')
    && state.headerPosition === 'fixed'
    && headerHeight >= 52
    && state.headerRegion === 'drag'
    && state.buttonRegion === 'no-drag'
    && state.sidebarTop >= headerHeight
    && state.actionsRight <= controlsStart
    && state.controlsWidth === '138px'
    && !normalClass?.includes('is-wco'),
  errors,
}, null, 2));
await browser.close();
