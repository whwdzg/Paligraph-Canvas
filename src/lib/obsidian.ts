import { markdownExcerpt, normalizeObsidianMarkdown, titleFromMarkdown } from './markdown';

/**
 * Browser import for Markdown files and Obsidian vault folders.
 *
 * The File System Access API and `webkitdirectory` expose relative paths but
 * not a stable directory handle across reloads, so files are read once and
 * copied into IndexedDB. Small image embeds are inlined as data URLs; larger
 * binaries are skipped and reported in the import summary.
 */

const MAX_FILES = 240;
const MAX_MARKDOWN_BYTES = 2.5 * 1024 * 1024;
const MAX_ASSET_BYTES = 1.6 * 1024 * 1024;
const MAX_ASSET_TOTAL = 14 * 1024 * 1024;
const MAX_ASSETS = 80;
const IMAGE_PATTERN = /\.(png|jpe?g|webp|gif|avif|svg)$/i;
const MARKDOWN_PATTERN = /\.(md|markdown|mdown)$/i;
const SKIP_DIRS = /(^|\/)(\.obsidian|\.git|node_modules|dist|build|\.trash|\.smart-env)(\/|$)/i;

export interface VaultFile {
  file: File;
  path: string;
}

export interface ImportedMarkdownNote {
  title: string;
  markdown: string;
  sourcePath: string;
  /** Vault-relative folder path (without the Markdown filename). */
  folderPath: string;
  excerpt: string;
  /** Only the attachments referenced by this note, keyed by relative path. */
  assets: Record<string, string>;
}

export interface VaultScanResult {
  notes: ImportedMarkdownNote[];
  skipped: number;
  assets: number;
  truncated: boolean;
  totalFiles: number;
}

export interface VaultScanProgress {
  phase: 'reading' | 'assets' | 'notes';
  current: number;
  total: number;
  label: string;
}

function relativePath(file: File): string {
  const withPath = file as File & { webkitRelativePath?: string };
  return (withPath.webkitRelativePath || file.name).replace(/\\/g, '/');
}

export function filesFromList(files: FileList | readonly File[]): VaultFile[] {
  return Array.from(files).map((file) => ({ file, path: relativePath(file) }));
}

/** Recursively walks a dropped directory when the browser exposes entries. */
export async function filesFromDataTransfer(items: DataTransferItemList): Promise<VaultFile[]> {
  const entries: FileSystemEntry[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const entry = items[i].webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (!entries.length) {
    return Array.from(items)
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))
      .map((file) => ({ file, path: file.name }));
  }

  const result: VaultFile[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (result.length >= MAX_FILES + 120) return;
    if (entry.isFile) {
      const file = await new Promise<File | null>((resolve) => {
        (entry as FileSystemFileEntry).file(resolve, () => resolve(null));
      });
      if (file) result.push({ file, path: entry.fullPath.replace(/^\//, '') });
      return;
    }
    if (!entry.isDirectory) return;
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const readBatch = (): Promise<FileSystemEntry[]> =>
      new Promise((resolve) => {
        reader.readEntries(resolve, () => resolve([]));
      });
    let batch = await readBatch();
    while (batch.length) {
      for (const child of batch) await walk(child);
      batch = await readBatch();
    }
  };

  for (const entry of entries) await walk(entry);
  return result;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read asset.'));
    reader.readAsDataURL(file);
  });
}

function assetKeys(path: string): string[] {
  const lower = path.toLowerCase();
  const basename = lower.split('/').pop() ?? lower;
  const withoutExtension = lower.replace(/\.[^.]+$/, '');
  const basenameWithoutExtension = basename.replace(/\.[^.]+$/, '');
  return [...new Set([lower, basename, withoutExtension, basenameWithoutExtension])];
}

/** Keeps only the data URLs actually referenced by a note, avoiding duplication. */
function attachmentSubset(source: string, all: ReadonlyMap<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  const add = (target: string): void => {
    const clean = target.split('|')[0].split('#')[0].trim().toLowerCase();
    if (!clean) return;
    for (const key of assetKeys(clean)) {
      const value = all.get(key);
      if (value) {
        result[key] = value;
        return;
      }
    }
  };
  for (const match of source.matchAll(/!\[\[([^\]]+)\]\]/g)) add(match[1]);
  for (const match of source.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) add(match[1]);
  return result;
}

/**
 * Reads a selected folder or a group of Markdown files. Notes are capped so a
 * 10k-note vault cannot exhaust a mobile browser's memory; the summary tells
 * the user exactly what was skipped.
 */
export async function scanVault(
  files: readonly VaultFile[],
  onProgress?: (progress: VaultScanProgress) => void,
): Promise<VaultScanResult> {
  const markdownFiles = files.filter(
    ({ file, path }) => MARKDOWN_PATTERN.test(path) && !SKIP_DIRS.test(path) && file.size <= MAX_MARKDOWN_BYTES,
  );
  const imageFiles = files.filter(
    ({ file, path }) =>
      IMAGE_PATTERN.test(path) &&
      !SKIP_DIRS.test(path) &&
      file.size <= MAX_ASSET_BYTES,
  );
  const truncated = markdownFiles.length > MAX_FILES;
  const selectedMarkdown = markdownFiles.slice(0, MAX_FILES);

  const assetMap = new Map<string, string>();
  let assetBytes = 0;
  let assetCount = 0;
  for (let i = 0; i < imageFiles.length && assetCount < MAX_ASSETS; i += 1) {
    if (assetBytes + imageFiles[i].file.size > MAX_ASSET_TOTAL) break;
    onProgress?.({ phase: 'assets', current: i + 1, total: imageFiles.length, label: imageFiles[i].path });
    try {
      const dataUrl = await fileToDataUrl(imageFiles[i].file);
      for (const key of assetKeys(imageFiles[i].path)) {
        if (!assetMap.has(key)) assetMap.set(key, dataUrl);
      }
      assetBytes += imageFiles[i].file.size;
      assetCount += 1;
    } catch {
      // A single unreadable attachment should not abort the whole vault.
    }
  }

  const notes: ImportedMarkdownNote[] = [];
  for (let i = 0; i < selectedMarkdown.length; i += 1) {
    const entry = selectedMarkdown[i];
    onProgress?.({ phase: 'notes', current: i + 1, total: selectedMarkdown.length, label: entry.path });
    try {
      const raw = await entry.file.text();
      const resolved = normalizeObsidianMarkdown(raw, assetMap);
      const title = titleFromMarkdown(raw, entry.file.name);
      const pathParts = entry.path.replace(/\\/g, '/').split('/').filter(Boolean);
      pathParts.pop();
      notes.push({
        title,
        markdown: raw,
        sourcePath: entry.path,
        folderPath: pathParts.join('/'),
        excerpt: markdownExcerpt(resolved),
        assets: attachmentSubset(raw, assetMap),
      });
    } catch {
      // Continue; the summary counts notes that made it in.
    }
  }

  return {
    notes,
    skipped: files.length - selectedMarkdown.length - assetCount,
    assets: assetCount,
    truncated,
    totalFiles: files.length,
  };
}

/** Called at render time to resolve image references stored in original Markdown. */
export function inlineAssets(source: string, assets: ReadonlyMap<string, string>): string {
  return normalizeObsidianMarkdown(source, assets);
}
