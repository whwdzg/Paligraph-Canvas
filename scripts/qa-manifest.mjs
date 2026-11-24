import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const manifestPath = resolve('public/manifest.webmanifest');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

function pngSize(path) {
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path);
  if (bytes.length < 24 || bytes.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function sizeString(size) {
  return `${size.width}x${size.height}`;
}

function checkIcon(icon) {
  const path = resolve('public', icon.src);
  const size = pngSize(path);
  return Boolean(size && sizeString(size) === icon.sizes && icon.type === 'image/png');
}

function checkScreenshot(screenshot) {
  const path = resolve('public', screenshot.src);
  const size = pngSize(path);
  return Boolean(size && sizeString(size) === screenshot.sizes && screenshot.form_factor);
}

const icons = manifest.icons ?? [];
const screenshots = manifest.screenshots ?? [];
const shortcuts = manifest.shortcuts ?? [];
const icon512 = icons.find((icon) => icon.purpose === 'any' && icon.sizes === '512x512');
const icon192 = icons.find((icon) => icon.purpose === 'any' && icon.sizes === '192x192');
const maskable = icons.find((icon) => icon.purpose === 'maskable');
const wide = screenshots.find((screenshot) => screenshot.form_factor === 'wide');
const narrow = screenshots.find((screenshot) => screenshot.form_factor === 'narrow');

const checks = {
  name: typeof manifest.name === 'string' && manifest.name.trim() === manifest.name && manifest.name.length > 0,
  shortName: typeof manifest.short_name === 'string' && manifest.short_name.length >= 3,
  description: typeof manifest.description === 'string' && manifest.description.length > 0,
  id: typeof manifest.id === 'string' && manifest.id.length > 0,
  startUrl: typeof manifest.start_url === 'string' && manifest.start_url.length > 0,
  scope: typeof manifest.scope === 'string' && manifest.scope.length > 0,
  display: ['fullscreen', 'standalone', 'minimal-ui', 'browser'].includes(manifest.display),
  colors: /^#[0-9a-f]{6}$/i.test(manifest.background_color) && /^#[0-9a-f]{6}$/i.test(manifest.theme_color),
  icons: Boolean(icon192 && icon512 && maskable && icons.every(checkIcon)),
  screenshots: screenshots.length >= 2 && Boolean(wide && narrow && screenshots.every(checkScreenshot)),
  files: Boolean(manifest.file_handlers?.length),
  launchHandler: typeof manifest.launch_handler?.client_mode !== 'undefined',
  displayOverride: Array.isArray(manifest.display_override) && manifest.display_override[0] === 'window-controls-overlay',
  handleLinks: ['auto', 'preferred', 'not-preferred'].includes(manifest.handle_links),
  edgeSidePanel: typeof manifest.edge_side_panel?.preferred_width === 'number',
  shortcut: shortcuts.length > 0 && shortcuts.every((shortcut) =>
    Boolean(shortcut.name && shortcut.url && shortcut.icons?.every((icon) => icon.type && icon.sizes)),
  ),
  categories: Array.isArray(manifest.categories) && manifest.categories.length > 0,
  language: typeof manifest.lang === 'string' && /^[a-z]{2}(-[A-Z]{2})?$/.test(manifest.lang),
  direction: ['ltr', 'rtl', 'auto'].includes(manifest.dir),
};

console.log(JSON.stringify({
  manifest: manifestPath,
  icons: icons.map((icon) => ({ src: icon.src, sizes: icon.sizes, purpose: icon.purpose })),
  screenshots: screenshots.map((screenshot) => ({
    src: screenshot.src,
    sizes: screenshot.sizes,
    formFactor: screenshot.form_factor,
    actual: pngSize(resolve('public', screenshot.src)),
  })),
  checks,
  pass: Object.values(checks).every(Boolean),
}, null, 2));
if (!Object.values(checks).every(Boolean)) process.exit(1);
