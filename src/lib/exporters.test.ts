import { describe, expect, it } from 'vitest';
import { parsePrintBlocks } from './exporters';
import { safeFilename } from './download';

describe('print Markdown', () => {
  it('recognises the common block structures', () => {
    const blocks = parsePrintBlocks([
      '# Heading',
      '',
      'A paragraph with **bold** text.',
      '',
      '- one',
      '- [ ] a task',
      '- [x] done',
      '',
      '> A quote',
      '',
      '```ts',
      'const x = 1;',
      '```',
    ].join('\n'));
    expect(blocks.map((block) => block.kind)).toEqual(['heading', 'paragraph', 'bullets', 'quote', 'code']);
    expect(blocks[1].text).toBe('A paragraph with bold text.');
    expect(blocks[2].items?.[1]).toContain('[ ] a task');
  });

  it('turns images into print placeholders', () => {
    const blocks = parsePrintBlocks('![Diagram](diagram.png)');
    expect(blocks[0]).toEqual({ kind: 'image', text: 'Diagram' });
  });

  it('sanitises filenames', () => {
    expect(safeFilename('A / B: C?', 'pdf')).toBe('A B C.pdf');
    expect(safeFilename('   ', 'md')).toBe('Paligraph note.md');
  });
});
