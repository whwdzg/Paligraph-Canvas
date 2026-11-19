import { describe, expect, it } from 'vitest';
import { formatBytes } from './format';
import { measureNotes, storagePercent, type StorageUsage } from './storageUsage';
import { DEFAULT_SETTINGS } from './settingsJson';
import type { Note } from './types';

const base: Note = {
  id: 'note-1',
  title: 'Storage test',
  markdown: '# Hello',
  assets: { 'a.png': 'data:image/png;base64,AAAA' },
  strokes: [
    {
      id: 'stroke-1',
      tool: 'pen',
      variant: 'pen',
      color: '#1f6feb',
      size: 4,
      opacity: 1,
      points: [{ x: 1, y: 2, p: 0.5 }, { x: 3, y: 4, p: 0.5 }],
      seed: 1,
      createdAt: 1,
    },
  ],
  images: [
    {
      id: 'image-1',
      src: 'data:image/png;base64,AAAAAAAA',
      name: 'one.png',
      mime: 'image/png',
      x: 0,
      y: 0,
      width: 64,
      height: 64,
      rotation: 0,
    },
  ],
  thumbnail: 'data:image/webp;base64,BBBB',
  background: DEFAULT_SETTINGS.defaultBackground,
  createdAt: 1,
  updatedAt: 2,
  schemaVersion: 1,
};

describe('storage usage estimates', () => {
  it('counts notes, images and their serialized categories', () => {
    const usage = measureNotes([base, { ...base, id: 'note-2', title: 'Second', images: [], strokes: [] }]);
    expect(usage.noteCount).toBe(2);
    expect(usage.imageCount).toBe(1);
    expect(usage.strokeBytes).toBeGreaterThan(0);
    expect(usage.imageBytes).toBeGreaterThan(0);
    expect(usage.markdownBytes).toBeGreaterThan(0);
    expect(usage.attachmentBytes).toBeGreaterThan(0);
    expect(usage.thumbnailBytes).toBeGreaterThan(0);
    expect(usage.totalBytes).toBe(
      usage.strokeBytes + usage.imageBytes + usage.markdownBytes + usage.attachmentBytes + usage.thumbnailBytes + usage.metadataBytes,
    );
  });

  it('formats byte sizes and computes quota ratios', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.00 KB');
    expect(formatBytes(12 * 1024 * 1024)).toBe('12.0 MB');
    const usage = { browserUsage: 25, browserQuota: 100, totalBytes: 10 } as StorageUsage;
    expect(storagePercent(usage)).toBe(0.25);
    expect(storagePercent({ ...usage, browserQuota: null })).toBe(0);
  });
});
