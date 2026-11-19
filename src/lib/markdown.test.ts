import { describe, expect, it } from 'vitest';
import { markdownExcerpt, normalizeObsidianMarkdown, titleFromMarkdown } from './markdown';

describe('Obsidian Markdown normalisation', () => {
  it('removes frontmatter from the rendered body', () => {
    const source = '---\ntitle: A note\ntags: [one, two]\n---\n\n# Heading\n\nBody';
    expect(normalizeObsidianMarkdown(source)).toBe('# Heading\n\nBody');
  });

  it('resolves wikilinks to readable text and embedded assets when available', () => {
    const assets = new Map([['diagram.png', 'data:image/png;base64,abc']]);
    const source = 'Read [[Another note|the other note]].\n\n![[diagram.png|A diagram]]';
    const normalised = normalizeObsidianMarkdown(source, assets);
    expect(normalised).toContain('the other note');
    expect(normalised).not.toContain('[[');
    expect(normalised).toContain('![A diagram](data:image/png;base64,abc)');
  });

  it('turns highlight syntax into a safe span', () => {
    expect(normalizeObsidianMarkdown('The ==important== part')).toContain('<span class="md-highlight">important</span>');
  });

  it('extracts a frontmatter title, heading or filename', () => {
    expect(titleFromMarkdown('---\ntitle: Front title\n---\nBody', 'file.md')).toBe('Front title');
    expect(titleFromMarkdown('# Heading\nBody', 'file.md')).toBe('Heading');
    expect(titleFromMarkdown('Body', 'my_note.md')).toBe('my note');
  });

  it('builds a compact plain-text excerpt', () => {
    const excerpt = markdownExcerpt('# Title\n\nSome **bold** text with [a link](https://example.com) and `code`.');
    expect(excerpt).toContain('Title');
    expect(excerpt).toContain('Some bold text');
    expect(excerpt).not.toContain('**');
    expect(excerpt.length).toBeLessThan(160);
  });
});
