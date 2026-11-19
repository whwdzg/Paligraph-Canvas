import type { Note } from './types';

const encoder = new TextEncoder();

export interface StorageUsage {
  noteCount: number;
  imageCount: number;
  strokeBytes: number;
  imageBytes: number;
  markdownBytes: number;
  attachmentBytes: number;
  thumbnailBytes: number;
  metadataBytes: number;
  notesBytes: number;
  settingsBytes: number;
  languageBytes: number;
  localBytes: number;
  totalBytes: number;
  browserUsage: number | null;
  browserQuota: number | null;
  persisted: boolean | null;
  measuredAt: number;
}

export interface NoteUsage {
  noteCount: number;
  imageCount: number;
  strokeBytes: number;
  imageBytes: number;
  markdownBytes: number;
  attachmentBytes: number;
  thumbnailBytes: number;
  metadataBytes: number;
  totalBytes: number;
}

function bytesOf(value: string): number {
  return encoder.encode(value).length;
}

/** Approximate the serialized size of the fields that make up a note. */
export function measureNotes(notes: readonly Note[]): NoteUsage {
  let strokeBytes = 0;
  let imageBytes = 0;
  let markdownBytes = 0;
  let attachmentBytes = 0;
  let thumbnailBytes = 0;
  let metadataBytes = 0;
  let imageCount = 0;

  for (const note of notes) {
    strokeBytes += bytesOf(JSON.stringify(note.strokes ?? []));
    markdownBytes += bytesOf(note.markdown ?? '');
    thumbnailBytes += bytesOf(note.thumbnail ?? '');
    for (const [key, value] of Object.entries(note.assets ?? {})) {
      attachmentBytes += bytesOf(key) + bytesOf(value);
    }
    for (const image of note.images ?? []) {
      imageCount += 1;
      imageBytes += bytesOf(image.src) + bytesOf(image.name) + 128;
    }
    metadataBytes += bytesOf(
      JSON.stringify({
        id: note.id,
        title: note.title,
        sourcePath: note.sourcePath,
        background: note.background,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        schemaVersion: note.schemaVersion,
      }),
    );
  }

  return {
    noteCount: notes.length,
    imageCount,
    strokeBytes,
    imageBytes,
    markdownBytes,
    attachmentBytes,
    thumbnailBytes,
    metadataBytes,
    totalBytes: strokeBytes + imageBytes + markdownBytes + attachmentBytes + thumbnailBytes + metadataBytes,
  };
}

function localBytes(): { settingsBytes: number; languageBytes: number; totalBytes: number } {
  let settingsBytes = 0;
  let languageBytes = 0;
  let totalBytes = 0;
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key) continue;
      const value = localStorage.getItem(key) ?? '';
      const size = bytesOf(key) + bytesOf(value);
      totalBytes += size;
      if (key === 'paligraph-settings') settingsBytes += size;
      else if (key.includes('language')) languageBytes += size;
    }
  } catch {
    // localStorage can be disabled by browser privacy settings; leave at zero.
  }
  return { settingsBytes, languageBytes, totalBytes };
}

/**
 * Browser quota is a best-effort estimate that includes caches and other
 * same-origin data. The note breakdown is computed from the note records
 * themselves so the panel is still useful when the Storage API is missing.
 */
export async function measureStorageUsage(notes: readonly Note[]): Promise<StorageUsage> {
  const noteUsage = measureNotes(notes);
  const local = localBytes();
  let browserUsage: number | null = null;
  let browserQuota: number | null = null;
  let persisted: boolean | null = null;
  try {
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      browserUsage = typeof estimate.usage === 'number' ? estimate.usage : null;
      browserQuota = typeof estimate.quota === 'number' ? estimate.quota : null;
    }
    if (navigator.storage?.persisted) persisted = await navigator.storage.persisted();
  } catch {
    // Storage estimates are optional and often unavailable in private windows.
  }
  const totalBytes = noteUsage.totalBytes + local.totalBytes;
  return {
    ...noteUsage,
    notesBytes: noteUsage.totalBytes,
    settingsBytes: local.settingsBytes,
    languageBytes: local.languageBytes,
    localBytes: local.totalBytes,
    totalBytes,
    browserUsage,
    browserQuota,
    persisted,
    measuredAt: Date.now(),
  };
}

export function storagePercent(usage: StorageUsage): number {
  const used = usage.browserUsage ?? usage.totalBytes;
  if (!usage.browserQuota || usage.browserQuota <= 0) return 0;
  return Math.max(0, Math.min(1, used / usage.browserQuota));
}
