import { describe, expect, it } from 'vitest';
import { parseEditableNoteJson, serializeEditableNote } from './editable';
import { DEFAULT_SETTINGS } from './settingsJson';
import type { Note } from './types';

const note: Note = {
  id: 'note-1',
  title: 'Editable note',
  markdown: '# Hello',
  createdAt: 1,
  updatedAt: 2,
  schemaVersion: 2,
  background: { ...DEFAULT_SETTINGS.defaultBackground },
  strokes: [
    {
      id: 'stroke-1',
      tool: 'pen',
      variant: 'pen',
      color: '#1f6feb',
      size: 4,
      opacity: 1,
      points: [{ x: 1, y: 2, p: 0.5 }, { x: 3, y: 4, p: 0.5 }],
      seed: 7,
      createdAt: 8,
      shape: 'line',
    },
  ],
  images: [
    {
      id: 'image-1',
      src: 'data:image/png;base64,iVBORw0KGgo=',
      name: 'dot.png',
      mime: 'image/png',
      x: 10,
      y: 20,
      width: 32,
      height: 32,
      rotation: 0.5,
    },
  ],
};

describe('editable note format', () => {
  it('round-trips strokes, images, Markdown and background', () => {
    const parsed = parseEditableNoteJson(serializeEditableNote(note));
    expect(parsed.title).toBe(note.title);
    expect(parsed.markdown).toBe(note.markdown);
    expect(parsed.strokes).toHaveLength(1);
    expect(parsed.strokes[0].shape).toBe('line');
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images?.[0]).toMatchObject({
      src: note.images?.[0].src,
      width: 32,
      rotation: 0.5,
    });
    expect(parsed.background.pattern).toBe('grid');
  });

  it('regenerates ids so imports cannot collide with existing notes', () => {
    const parsed = parseEditableNoteJson(serializeEditableNote(note));
    expect(parsed.strokes[0].id).not.toBe('stroke-1');
    expect(parsed.images?.[0].id).not.toBe('image-1');
  });

  it('rejects empty or unsupported documents', () => {
    expect(() => parseEditableNoteJson('{"format":"paligraph-note","version":99,"note":{"title":"x"}}')).toThrow();
    expect(() => parseEditableNoteJson('{"format":"paligraph-note","version":1,"note":{"title":"x"}}')).toThrow();
    expect(() => parseEditableNoteJson('not json')).toThrow();
  });
});
