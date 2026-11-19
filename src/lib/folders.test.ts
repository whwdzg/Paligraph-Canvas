import { describe, expect, it } from 'vitest';
import {
  buildFolderTree,
  collectFolderIds,
  flattenFolderTree,
  folderPathName,
  uniqueFolderName,
} from './folders';
import type { Note, NoteFolder } from './types';

const folder = (id: string, name: string, parentId: string | null = null): NoteFolder => ({
  id,
  name,
  parentId,
  createdAt: 1,
  updatedAt: 1,
});

const note = (id: string, folderId: string | null): Note => ({
  id,
  title: id,
  markdown: '',
  folderId,
  strokes: [],
  background: { pattern: 'grid', lineStyle: 'solid', spacing: 32, opacity: 0.14, color: '' },
  createdAt: 1,
  updatedAt: 1,
  schemaVersion: 1,
});

describe('folder tree', () => {
  const folders = [
    folder('a', 'Alpha'),
    folder('b', 'Beta', 'a'),
    folder('c', 'Gamma', 'b'),
    folder('d', 'Delta'),
  ];

  it('builds nested paths, depths and descendant counts', () => {
    const tree = buildFolderTree(folders, [note('1', 'a'), note('2', 'b'), note('3', 'c'), note('4', 'd')]);
    const flat = flattenFolderTree(tree);
    expect(flat.map((item) => item.name)).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta']);
    expect(flat.find((item) => item.id === 'c')?.path).toBe('Alpha / Beta / Gamma');
    expect(flat.find((item) => item.id === 'c')?.depth).toBe(2);
    expect(flat.find((item) => item.id === 'a')?.totalCount).toBe(3);
    expect(folderPathName(folders, 'c')).toBe('Alpha / Beta / Gamma');
  });

  it('collects descendants and avoids duplicate sibling names', () => {
    expect([...collectFolderIds(folders, 'a')].sort()).toEqual(['a', 'b', 'c']);
    expect(uniqueFolderName(folders, null, 'Alpha')).toBe('Alpha 2');
    expect(uniqueFolderName(folders, 'a', 'Beta', 'b')).toBe('Beta');
    expect(uniqueFolderName(folders, null, '  New   folder  ')).toBe('New folder');
  });
});
