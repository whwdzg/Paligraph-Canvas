import { useMemo, useState } from 'react';
import {
  Add24Regular,
  ArrowUpload24Regular,
  Dismiss24Regular,
  DocumentText24Regular,
  MoreHorizontal24Regular,
  Search24Regular,
  ShieldCheckmark24Regular,
  Delete24Regular,
} from '@fluentui/react-icons';
import { useI18n } from '../../i18n/I18nProvider';
import { formatNoteTime, truncate } from '../../lib/format';
import type { Note } from '../../lib/types';

/** Lightweight excerpt for the list: never loads the Markdown renderer. */
function plainExcerpt(source: string, maximum = 90): string {
  const text = source
    .replace(/^---[\s\S]*?\n---\n?/, '')
    .replace(/!\[\[[^\]]+\]\]/g, ' ')
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~=]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length <= maximum ? text : `${text.slice(0, maximum).trimEnd()}…`;
}

interface NoteSidebarProps {
  notes: Note[];
  activeId: string | null;
  open: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onImport: () => void;
  onDeleteRequest: (note: Note) => void;
}

function NoteThumb({ note }: { note: Note }) {
  if (note.thumbnail) {
    return <img className="note-thumb" src={note.thumbnail} alt="" draggable={false} />;
  }
  return (
    <span className="note-thumb note-thumb-placeholder" aria-hidden="true">
      {note.markdown ? <DocumentText24Regular /> : <span className="thumb-stroke" />}
    </span>
  );
}

export function NoteSidebar({
  notes,
  activeId,
  open,
  onClose,
  onSelect,
  onCreate,
  onImport,
  onDeleteRequest,
}: NoteSidebarProps) {
  const { t, language } = useI18n();
  const [query, setQuery] = useState('');
  const [menuNoteId, setMenuNoteId] = useState<string | null>(null);
  const now = Date.now();

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return notes;
    return notes.filter((note) =>
      `${note.title}\n${note.markdown}\n${note.sourcePath ?? ''}`.toLowerCase().includes(term),
    );
  }, [notes, query]);

  return (
    <>
      {open ? <button className="sidebar-scrim" type="button" aria-label={t('common.close')} onClick={onClose} /> : null}
      <aside className={`sidebar ${open ? 'is-open' : ''}`.trim()} aria-label={t('sidebar.notes')}>
        <header className="sidebar-brand">
          <img className="brand-mark" src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" width={36} height={36} />
          <div className="brand-copy">
            <strong>Paligraph</strong>
            <span>{t('app.tagline')}</span>
          </div>
          <button type="button" className="icon-button sidebar-close" onClick={onClose} aria-label={t('common.close')}>
            <Dismiss24Regular />
          </button>
        </header>

        <div className="sidebar-actions">
          <button type="button" className="new-note-button" onClick={onCreate}>
            <span className="new-note-icon"><Add24Regular /></span>
            <span>{t('sidebar.newNote')}</span>
            <kbd>N</kbd>
          </button>
          <button type="button" className="import-button" onClick={onImport} title={t('import.title')}>
            <ArrowUpload24Regular />
            <span>{t('sidebar.import')}</span>
          </button>
        </div>

        <label className="search-field">
          <Search24Regular aria-hidden="true" />
          <span className="visually-hidden">{t('sidebar.search')}</span>
          <input
            type="search"
            value={query}
            placeholder={t('sidebar.searchPlaceholder')}
            onChange={(event) => setQuery(event.target.value)}
            spellCheck={false}
          />
          {query ? (
            <button type="button" onClick={() => setQuery('')} aria-label={t('common.clear')}>
              <Dismiss24Regular />
            </button>
          ) : null}
        </label>

        <div className="sidebar-section-heading">
          <span>{query ? t('sidebar.results') : t('sidebar.allNotes')}</span>
          <span className="note-count">{filtered.length}</span>
        </div>

        <div className="note-list" role="list">
          {filtered.map((note) => {
            const strokes = note.strokes.filter((stroke) => stroke.tool !== 'eraser').length;
            const images = note.images?.length ?? 0;
            const excerpt = note.markdown
              ? plainExcerpt(note.markdown, 90)
              : strokes || images
                ? [strokes ? t('note.strokeCount', { count: strokes }) : '', images ? t('note.images', { count: images }) : '']
                    .filter(Boolean)
                    .join(' · ')
                : t('note.empty');
            return (
              <div key={note.id} className="note-card-wrap" role="listitem">
                <button
                  type="button"
                  className={`note-card ${note.id === activeId ? 'is-active' : ''}`.trim()}
                  onClick={() => onSelect(note.id)}
                  aria-current={note.id === activeId ? 'page' : undefined}
                >
                  <NoteThumb note={note} />
                  <span className="note-card-copy">
                    <span className="note-card-title">{note.title || t('note.untitled')}</span>
                    <span className="note-card-meta">
                      <span>{formatNoteTime(note.updatedAt, language, t, now)}</span>
                      {note.markdown ? <span className="note-badge">MD</span> : null}
                    </span>
                    <span className="note-card-excerpt">{truncate(excerpt, 66)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className={`note-menu-trigger ${menuNoteId === note.id ? 'is-open' : ''}`.trim()}
                  aria-label={t('sidebar.noteMenu')}
                  aria-expanded={menuNoteId === note.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuNoteId((current) => (current === note.id ? null : note.id));
                  }}
                >
                  <MoreHorizontal24Regular />
                </button>
                {menuNoteId === note.id ? (
                  <>
                    <button className="note-menu-scrim" type="button" aria-label={t('common.close')} onClick={() => setMenuNoteId(null)} />
                    <div className="note-menu" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        className="danger"
                        onClick={() => {
                          setMenuNoteId(null);
                          onDeleteRequest(note);
                        }}
                      >
                        <Delete24Regular />
                        {t('sidebar.deleteNote')}
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            );
          })}
          {!filtered.length ? (
            <div className="notes-empty">
              <Search24Regular />
              <p>{t('sidebar.noMatches')}</p>
              <button type="button" className="text-button" onClick={() => setQuery('')}>{t('common.clear')}</button>
            </div>
          ) : null}
        </div>

        <footer className="sidebar-footer">
          <ShieldCheckmark24Regular />
          <div>
            <strong>{t('sidebar.localFirst')}</strong>
            <span>{t('sidebar.localHint')}</span>
          </div>
        </footer>
      </aside>
    </>
  );
}
