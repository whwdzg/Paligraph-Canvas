import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Produces the images used by README.md. Requires `npm run preview` and an
 * installed Edge/Chrome. All data is created in an isolated browser profile.
 */
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
].filter(Boolean);
const executablePath = candidates.find((candidate) => existsSync(candidate));
if (!executablePath) throw new Error('No Chrome/Edge executable found.');
await mkdir('docs', { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true });

async function newPage({ theme, viewport, deviceScaleFactor = 1, hasTouch = false, isMobile = false }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor,
    hasTouch,
    isMobile,
    locale: 'zh-CN',
    colorScheme: theme === 'dark' ? 'dark' : 'light',
  });
  await context.addInitScript((selectedTheme) => {
    localStorage.setItem(
      'paligraph-settings',
      JSON.stringify({ state: { theme: selectedTheme, language: 'zh-CN' }, version: 1 }),
    );
  }, theme);
  const page = await context.newPage();
  await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.app-shell:not(.app-skeleton)');
  await page.waitForTimeout(900);
  return { page, context };
}

// 1. Light hero: the first-run ink note.
{
  const { page, context } = await newPage({ theme: 'light', viewport: { width: 1440, height: 900 } });
  await page.screenshot({ path: 'docs/hero-light.png' });
  await context.close();
}

// 2. Dark hero: imported Markdown with a real highlighter annotation.
{
  const { page, context } = await newPage({ theme: 'dark', viewport: { width: 1440, height: 900 } });
  await page.getByRole('button', { name: '导入', exact: true }).first().click();
  await page.waitForSelector('.import-modal');
  await page.locator('.import-modal input[accept*=".md"]').setInputFiles(path.resolve('scripts/fixtures/sample-import.md'));
  await page.waitForSelector('.import-result');
  await page.locator('.import-modal .modal-footer .primary').click();
  await page.waitForTimeout(1600);

  const closeToast = page.locator('.toast-close');
  while (await closeToast.count()) {
    await closeToast.first().click();
    await page.waitForTimeout(120);
  }
  await page.mouse.move(120, 300);
  await page.waitForTimeout(2200);
  await page.screenshot({ path: 'docs/hero-dark.png' });
  await context.close();
}

// 3. Tool options surface.
{
  const { page, context } = await newPage({ theme: 'light', viewport: { width: 1440, height: 900 } });
  await page.locator('.tools-main .tool-button').first().click();
  await page.waitForSelector('.tool-options');
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'docs/tool-options.png' });
  await context.close();
}

// 4. Mobile first-run view.
{
  const { page, context } = await newPage({
    theme: 'light',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  await page.screenshot({ path: 'docs/mobile.png' });
  await context.close();
}

await browser.close();
console.log('screenshots written to docs/');
