import { describe, expect, it } from 'vitest';
import { scanVault } from './obsidian';

function markdownFile(name: string, body: string): File {
  return new File([body], name, { type: 'text/markdown' });
}

describe('Obsidian vault import', () => {
  it('keeps each note’s original folder path', async () => {
    const root = markdownFile('Root.md', '# Root');
    const nested = markdownFile('Nested.md', '# Nested');
    const deep = markdownFile('Deep.md', '# Deep');
    const result = await scanVault([
      { file: root, path: 'MyVault/Root.md' },
      { file: nested, path: 'MyVault/Projects/Nested.md' },
      { file: deep, path: 'MyVault/Projects/Archive/Deep.md' },
    ]);
    expect(result.notes).toHaveLength(3);
    expect(result.notes.map((note) => note.folderPath).sort()).toEqual([
      'MyVault',
      'MyVault/Projects',
      'MyVault/Projects/Archive',
    ]);
  });
});
