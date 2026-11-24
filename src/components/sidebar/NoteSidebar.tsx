import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  Add24Regular,
  ArrowUpload24Regular,
  Checkmark24Regular,
  ChevronDown24Regular,
  ChevronRight24Regular,
  Code24Regular,
  Delete24Regular,
  Dismiss24Regular,
  DocumentPdf24Regular,
  DocumentText24Regular,
  Folder24Regular,
  FolderAdd24Regular,
  FolderArrowRight24Regular,
  FolderOpen24Regular,

  Image24Regular,
  MoreHorizontal24Regular,
  Save24Regular,
  Search24Regular,
  ShieldCheckmark24Regular,
} from '@fluentui/react-icons';
import { useI18n } from '../../i18n/I18nProvider';
import { PwaInstallPrompt } from '../pwa/PwaInstallPrompt';
import type { PwaInstallController } from '../../hooks/usePwaInstall';
import { buildFolderTree, folderPathName, type FolderNode } from '../../lib/folders';
import { formatNoteTime, truncate } from '../../lib/format';
import type { FolderFilter, Note, NoteExportFormat, NoteFolder } from '../../lib/types';

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
  folders: NoteFolder[];
  activeId: string | null;
  open: boolean;
  folderId: FolderFilter;
  onFolderSelect: (folderId: FolderFilter) => void;
  onClose: () => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onImport: () => void;
  onDeleteRequest: (note: Note) => void;
  onMoveNote: (note: Note) => void;
  onExportNote: (note: Note, format: NoteExportFormat) => void;
  onCreateFolder: (parentId: string | null) => void;
  onRenameFolder: (folder: NoteFolder) => void;
  onDeleteFolder: (folder: NoteFolder) => void;
  selectionMode: boolean;
  selectedIds: ReadonlySet<string>;
  onSelectionModeChange: (active: boolean) => void;
  onToggleSelected: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onDeleteSelected: () => void;
  onMoveSelected: () => void;
  pwa: PwaInstallController;
  installPromptDismissed: boolean;
  onInstallPwa: () => void;
  onOpenInstallGuide: () => void;
  onDismissInstallPrompt: () => void;
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

interface MenuPosition {
  top: number;
  left: number;
}

export function NoteSidebar({
  notes,
  folders,
  activeId,
  open,
  folderId,
  onFolderSelect,
  onClose,
  onSelect,
  onCreate,
  onImport,
  onDeleteRequest,
  onMoveNote,
  onExportNote,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  selectionMode,
  selectedIds,
  onSelectionModeChange,
  onToggleSelected,
  onSelectAll,
  onDeleteSelected,
  onMoveSelected,
  pwa,
  installPromptDismissed,
  onInstallPwa,
  onOpenInstallGuide,
  onDismissInstallPrompt,
}: NoteSidebarProps) {
  const { t, language } = useI18n();
  const [query, setQuery] = useState('');
  const [menuNoteId, setMenuNoteId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({ top: 0, left: 0 });
  const [folderMenu, setFolderMenu] = useState<(MenuPosition & { id: string }) | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const foldersInitialised = useRef(false);
  const now = Date.now();

  const tree = useMemo(() => buildFolderTree(folders, notes), [folders, notes]);
  const currentFolderName =
    folderId === 'all'
      ? t('sidebar.allNotes')
      : folderId === 'uncategorized'
        ? t('sidebar.uncategorized')
        : folderPathName(folders, folderId) || t('sidebar.allNotes');

  const visibleNotes = useMemo(() => {
    if (folderId === 'all') return notes;
    if (folderId === 'uncategorized') return notes.filter((note) => !note.folderId);
    return notes.filter((note) => note.folderId === folderId);
  }, [folderId, notes]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return visibleNotes;
    return visibleNotes.filter((note) =>
      `${note.title}\n${note.markdown}\n${note.sourcePath ?? ''}`.toLowerCase().includes(term),
    );
  }, [visibleNotes, query]);

  const allSelected = filtered.length > 0 && filtered.every((note) => selectedIds.has(note.id));
  const uncategorizedCount = notes.filter((note) => !note.folderId).length;

  useEffect(() => {
    if (foldersInitialised.current || !folders.length) return;
    foldersInitialised.current = true;
    setExpanded(new Set(folders.map((folder) => folder.id)));
  }, [folders]);

  useEffect(() => {
    if (folderId === 'all' || folderId === 'uncategorized') return;
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const ancestors = new Set<string>();
    let current = byId.get(folderId);
    while (current) {
      ancestors.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    setExpanded((previous) => {
      const next = new Set(previous);
      for (const id of ancestors) next.add(id);
      return next;
    });
  }, [folderId, folders]);

  useEffect(() => {
    setMenuNoteId(null);
    setFolderMenu(null);
  }, [folderId, selectionMode]);

  useEffect(() => {
    if (!menuNoteId && !folderMenu) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setMenuNoteId(null);
        setFolderMenu(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [folderMenu, menuNoteId]);

  const showNoteMenu = (note: Note, left: number, top: number): void => {
    const width = 214;
    const height = 360;
    setMenuPosition({
      left: Math.min(window.innerWidth - width - 8, Math.max(8, left)),
      top: Math.min(window.innerHeight - height - 8, Math.max(8, top)),
    });
    setFolderMenu(null);
    setMenuNoteId(note.id);
  };

  const openNoteMenu = (event: MouseEvent<HTMLButtonElement>, note: Note): void => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    showNoteMenu(
      note,
      rect.right - 214,
      rect.bottom + 360 > window.innerHeight ? window.innerHeight - 360 - 8 : rect.bottom + 4,
    );
  };

  const openNoteMenuAtPointer = (event: MouseEvent<HTMLElement>, note: Note): void => {
    event.preventDefault();
    event.stopPropagation();
    if (selectionMode) return;
    const height = 360;
    showNoteMenu(
      note,
      event.clientX,
      event.clientY + height > window.innerHeight ? event.clientY - height - 8 : event.clientY,
    );
  };

  const openFolderMenu = (event: MouseEvent<HTMLButtonElement>, folder: FolderNode): void => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 176;
    const height = 132;
    const left = Math.min(window.innerWidth - width - 8, Math.max(8, rect.right - width));
    const top = rect.bottom + height > window.innerHeight
      ? Math.max(8, rect.top - height - 4)
      : rect.bottom + 4;
    setMenuNoteId(null);
    setFolderMenu((current) => (current?.id === folder.id ? null : { id: folder.id, left, top }));
  };

  const closeMenus = (): void => {
    setMenuNoteId(null);
    setFolderMenu(null);
  };

  const activeMenuNote = menuNoteId ? notes.find((note) => note.id === menuNoteId) ?? null : null;
  const activeFolderMenu = folderMenu ? folders.find((folder) => folder.id === folderMenu.id) ?? null : null;

  const renderFolder = (node: FolderNode): React.ReactNode => {
    const isExpanded = expanded.has(node.id);
    const hasChildren = node.children.length > 0;
    return (
      <div key={node.id} className="folder-tree-node">
        <div className={`folder-row ${folderId === node.id ? 'is-active' : ''}`.trim()}>
          <button
            type="button"
            className="folder-expand"
            aria-label={isExpanded ? t('folder.collapse') : t('folder.expand')}
            aria-expanded={hasChildren ? isExpanded : undefined}
            onClick={() => {
              if (!hasChildren) return;
              setExpanded((previous) => {
                const next = new Set(previous);
                if (next.has(node.id)) next.delete(node.id);
                else next.add(node.id);
                return next;
              });
            }}
          >
            {hasChildren ? (
              isExpanded ? <ChevronDown24Regular /> : <ChevronRight24Regular />
            ) : <span className="folder-expand-spacer" />}
          </button>
          <button type="button" className="folder-select" onClick={() => onFolderSelect(node.id)}>
            <Folder24Regular />
            <span className="folder-name" title={node.path}>{node.name}</span>
            <span className="folder-count">{node.totalCount}</span>
          </button>
          <button
            type="button"
            className={`folder-more ${folderMenu?.id === node.id ? 'is-open' : ''}`.trim()}
            aria-label={t('folder.actions')}
            onClick={(event) => openFolderMenu(event, node)}
          >
            <MoreHorizontal24Regular />
          </button>
        </div>
        {hasChildren && isExpanded ? (
          <div className="folder-children">
            {node.children.map((child) => renderFolder(child))}
          </div>
        ) : null}
      </div>
    );
  };

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

        <div className="folder-panel">
          <div className="folder-panel-heading">
            <span>{t('folder.title')}</span>
            <button
              type="button"
              className="folder-add"
              aria-label={t('folder.createTitle')}
              title={t('folder.createTitle')}
              onClick={() => onCreateFolder(null)}
            >
              <FolderAdd24Regular />
            </button>
          </div>
          <div className="folder-tree">
            <button
              type="button"
              className={`folder-static ${folderId === 'all' ? 'is-active' : ''}`.trim()}
              onClick={() => onFolderSelect('all')}
            >
              <FolderOpen24Regular />
              <span>{t('sidebar.allNotes')}</span>
              <span className="folder-count">{notes.length}</span>
            </button>
            <button
              type="button"
              className={`folder-static ${folderId === 'uncategorized' ? 'is-active' : ''}`.trim()}
              onClick={() => onFolderSelect('uncategorized')}
            >
              <DocumentText24Regular />
              <span>{t('sidebar.uncategorized')}</span>
              <span className="folder-count">{uncategorizedCount}</span>
            </button>
            {tree.map((node) => renderFolder(node))}
          </div>
        </div>

        <div className="sidebar-section-heading notes-heading">
          <span>{currentFolderName}</span>
          <div className="notes-heading-actions">
            <span className="note-count">{filtered.length}</span>
            {!selectionMode ? (
              <button type="button" className="text-button note-select-entry" onClick={() => onSelectionModeChange(true)}>
                {t('selection.enter')}
              </button>
            ) : null}
          </div>
        </div>

        {selectionMode ? (
          <div className="note-selection-bar">
            <span className="selection-summary">{t('selection.selected', { count: selectedIds.size })}</span>
            <div className="selection-bar-actions">
              <button
                type="button"
                className="text-button"
                onClick={() => onSelectAll(allSelected ? [] : filtered.map((note) => note.id))}
              >
                {allSelected ? t('selection.clearAll') : t('selection.selectAll')}
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={t('selection.move')}
                title={t('selection.move')}
                disabled={!selectedIds.size}
                onClick={onMoveSelected}
              >
                <FolderArrowRight24Regular />
              </button>
              <button
                type="button"
                className="icon-button danger"
                aria-label={t('common.delete')}
                title={t('common.delete')}
                disabled={!selectedIds.size}
                onClick={onDeleteSelected}
              >
                <Delete24Regular />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={t('selection.cancel')}
                title={t('selection.cancel')}
                onClick={() => onSelectionModeChange(false)}
              >
                <Dismiss24Regular />
              </button>
            </div>
          </div>
        ) : null}

        <div className="note-list" role="list">
          {filtered.map((note) => {
            const strokes = note.strokes.filter((stroke) => stroke.tool !== 'eraser').length;
            const images = note.images?.filter((image) => !image.text).length ?? 0;
            const textBlocks = note.images?.filter((image) => image.text).length ?? 0;
            const selected = selectedIds.has(note.id);
            const excerpt = note.markdown
              ? plainExcerpt(note.markdown, 90)
              : strokes || images || textBlocks
                ? [
                    strokes ? t('note.strokeCount', { count: strokes }) : '',
                    images ? t('note.images', { count: images }) : '',
                    textBlocks ? t('note.textBlocks', { count: textBlocks }) : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : t('note.empty');
            return (
              <div key={note.id} className="note-card-wrap" role="listitem">
                <button
                  type="button"
                  className={[
                    'note-card',
                    note.id === activeId ? 'is-active' : '',
                    selected ? 'is-selected' : '',
                    selectionMode ? 'is-selecting' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => {
                    closeMenus();
                    if (selectionMode) onToggleSelected(note.id);
                    else onSelect(note.id);
                  }}
                  onContextMenu={(event) => openNoteMenuAtPointer(event, note)}
                  aria-current={!selectionMode && note.id === activeId ? 'page' : undefined}
                  aria-pressed={selectionMode ? selected : undefined}
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
                {selectionMode ? (
                  <span className={`note-select-box ${selected ? 'is-checked' : ''}`.trim()} aria-hidden="true">
                    {selected ? <Checkmark24Regular /> : null}
                  </span>
                ) : (
                  <button
                    type="button"
                    className={`note-menu-trigger ${menuNoteId === note.id ? 'is-open' : ''}`.trim()}
                    aria-label={t('sidebar.noteMenu')}
                    aria-expanded={menuNoteId === note.id}
                    onClick={(event) => {
                      if (menuNoteId === note.id) {
                        closeMenus();
                        return;
                      }
                      openNoteMenu(event, note);
                    }}
                  >
                    <MoreHorizontal24Regular />
                  </button>
                )}
              </div>
            );
          })}
          {!filtered.length ? (
            <div className="notes-empty">
              <Search24Regular />
              <p>{query ? t('sidebar.noMatches') : folderId === 'all' ? t('sidebar.noNotes') : t('sidebar.emptyFolder')}</p>
              {query ? (
                <button type="button" className="text-button" onClick={() => setQuery('')}>{t('common.clear')}</button>
              ) : null}
            </div>
          ) : null}
        </div>

        {!pwa.installed && !installPromptDismissed && (pwa.canInstall || pwa.isIos) ? (
          <PwaInstallPrompt
            pwa={pwa}
            onInstall={onInstallPwa}
            onGuide={onOpenInstallGuide}
            onDismiss={onDismissInstallPrompt}
          />
        ) : null}

        <footer className="sidebar-footer">
          <ShieldCheckmark24Regular />
          <div>
            <strong>{t('sidebar.localFirst')}</strong>
            <span>{t('sidebar.localHint')}</span>
          </div>
        </footer>
      </aside>

      {(activeMenuNote || activeFolderMenu) ? createPortal(
        <>
          <button className="note-menu-scrim" type="button" aria-label={t('common.close')} onClick={closeMenus} />
          {activeMenuNote ? (
            <div
              className="note-menu is-floating"
              role="menu"
              style={{ top: menuPosition.top, left: menuPosition.left }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenus();
                  onMoveNote(activeMenuNote);
                }}
              >
                <FolderArrowRight24Regular />
                {t('folder.moveNote')}
              </button>
              <div className="note-menu-label">{t('noteMenu.exportNote')}</div>
              <button type="button" role="menuitem" onClick={() => { closeMenus(); onExportNote(activeMenuNote, 'pdf'); }}>
                <DocumentPdf24Regular />
                {t('export.pdf')}
              </button>
              <button type="button" role="menuitem" onClick={() => { closeMenus(); onExportNote(activeMenuNote, 'markdown'); }}>
                <DocumentText24Regular />
                {t('export.markdown')}
              </button>
              <button type="button" role="menuitem" onClick={() => { closeMenus(); onExportNote(activeMenuNote, 'png'); }}>
                <Image24Regular />
                {t('export.png')}
              </button>
              <button type="button" role="menuitem" onClick={() => { closeMenus(); onExportNote(activeMenuNote, 'svg'); }}>
                <Code24Regular />
                {t('export.svg')}
              </button>
              <button type="button" role="menuitem" onClick={() => { closeMenus(); onExportNote(activeMenuNote, 'editable'); }}>
                <Save24Regular />
                {t('export.editable')}
              </button>
              <div className="note-menu-separator" />
              <button
                type="button"
                role="menuitem"
                className="danger"
                onClick={() => {
                  closeMenus();
                  onDeleteRequest(activeMenuNote);
                }}
              >
                <Delete24Regular />
                {t('sidebar.deleteNote')}
              </button>
            </div>
          ) : null}
          {activeFolderMenu ? (
            <div
              className="note-menu is-floating folder-menu"
              role="menu"
              style={{ top: folderMenu?.top, left: folderMenu?.left }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenus();
                  onCreateFolder(activeFolderMenu.id);
                }}
              >
                <FolderAdd24Regular />
                {t('folder.newSubfolder')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenus();
                  onRenameFolder(activeFolderMenu);
                }}
              >
                <Folder24Regular />
                {t('folder.rename')}
              </button>
              <button
                type="button"
                role="menuitem"
                className="danger"
                onClick={() => {
                  closeMenus();
                  onDeleteFolder(activeFolderMenu);
                }}
              >
                <Delete24Regular />
                {t('folder.delete')}
              </button>
            </div>
          ) : null}
        </>,
        document.body,
      ) : null}
    </>
  );
}
