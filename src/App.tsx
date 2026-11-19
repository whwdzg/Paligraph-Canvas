import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Add24Regular,
  FolderOpen24Regular,
  Sparkle24Regular,
} from '@fluentui/react-icons';
import { EditorHeader } from './components/editor/EditorHeader';
import { DrawingSurface, type DrawingSurfaceHandle } from './components/canvas/DrawingSurface';
import { ToolDock } from './components/editor/ToolDock';
import { ToolOptions } from './components/editor/ToolOptions';
import { BackgroundPanel } from './components/editor/BackgroundPanel';
import { SelectionToolbar } from './components/editor/SelectionToolbar';
import { ZoomControls } from './components/editor/ZoomControls';
import { EmptyCanvasHint } from './components/editor/EmptyCanvasHint';
import { SourcePanel } from './components/editor/SourcePanel';
import { ImagePreviewDialog } from './components/editor/ImagePreviewDialog';
import { NoteSidebar } from './components/sidebar/NoteSidebar';
import { FolderNameDialog } from './components/sidebar/FolderNameDialog';
import { MoveToFolderDialog } from './components/sidebar/MoveToFolderDialog';
import { SettingsDialog } from './components/settings/SettingsDialog';
import { ConfirmDialog } from './components/common/ConfirmDialog';
import { ToastHost } from './components/common/ToastHost';
import { useI18n } from './i18n/I18nProvider';
import { useNotes } from './hooks/useNotes';
import { useThemeSync } from './hooks/useTheme';
import { useToasts } from './hooks/useToasts';
import { useClickOutside } from './hooks/useClickOutside';
import { prepareImageFile, type PreparedImage } from './lib/media';
import { parseEditableNoteJson, type ImportedNote } from './lib/editable';
import { collectFolderIds, folderPathName } from './lib/folders';
import type {
  BackgroundSettings,
  FolderFilter,
  InkTool,
  Note,
  NoteExportFormat,
  NoteFolder,
  Selection,
  Settings,
  Stroke,
} from './lib/types';
import type { ImportedMarkdownNote } from './lib/obsidian';
import { useSettingsStore } from './state/settings';

type ToolWithOptions = Exclude<InkTool, 'lasso'>;

// Markdown, Obsidian scanning and PDF generation live in on-demand chunks so
// the first paint only ships the canvas and UI.
const ImportDialog = lazy(async () => {
  const module = await import('./components/editor/ImportDialog');
  return { default: module.ImportDialog };
});
const MathDialog = lazy(async () => {
  const module = await import('./components/editor/MathDialog');
  return { default: module.MathDialog };
});

function LibraryEmpty({
  onCreate,
  onImport,
}: {
  onCreate: () => void;
  onImport: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="library-empty">
      <div className="library-empty-mark"><Sparkle24Regular /></div>
      <h1>{t('library.emptyTitle')}</h1>
      <p>{t('library.emptyBody')}</p>
      <div className="library-empty-actions">
        <button type="button" className="fluent-button primary" onClick={onCreate}>
          <Add24Regular />
          {t('sidebar.newNote')}
        </button>
        <button type="button" className="fluent-button" onClick={onImport}>
          <FolderOpen24Regular />
          {t('sidebar.import')}
        </button>
      </div>
    </div>
  );
}

function AppSkeleton() {
  return (
    <div className="app-shell app-skeleton" aria-busy="true">
      <aside className="sidebar skeleton-sidebar">
        <div className="skeleton-brand">
          <span className="skeleton-block skeleton-mark" />
          <span className="skeleton-block skeleton-line" style={{ width: 92 }} />
        </div>
        <span className="skeleton-block skeleton-search" />
        {Array.from({ length: 4 }).map((_, index) => (
          <div className="skeleton-note" key={index}>
            <span className="skeleton-block skeleton-thumb" />
            <span className="skeleton-copy">
              <span className="skeleton-block skeleton-line" style={{ width: `${68 + index * 5}%` }} />
              <span className="skeleton-block skeleton-line small" style={{ width: '38%' }} />
            </span>
          </div>
        ))}
      </aside>
      <main className="skeleton-main">
        <div className="skeleton-header"><span className="skeleton-block" style={{ width: 210, height: 28 }} /></div>
        <div className="skeleton-paper">
          <span className="skeleton-block" style={{ width: 320, height: 18 }} />
          <span className="skeleton-block" style={{ width: 420, height: 14 }} />
          <span className="skeleton-block" style={{ width: 260, height: 14 }} />
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const { t } = useI18n();
  const theme = useThemeSync();
  const settings = useSettingsStore();
  const store = useNotes(t, theme);
  const { toasts, pushToast, dismissToast } = useToasts();
  const [tool, setTool] = useState<InkTool>('pen');
  const [inspector, setInspector] = useState<ToolWithOptions | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [history, setHistory] = useState({ undo: false, redo: false });
  const [scale, setScale] = useState(1);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<Note | null>(null);
  const [folderFilter, setFolderFilter] = useState<FolderFilter>('all');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [folderDialog, setFolderDialog] = useState<{
    mode: 'create' | 'rename';
    parentId: string | null;
    folder?: NoteFolder;
    initialName: string;
  } | null>(null);
  const [moveRequest, setMoveRequest] = useState<{ ids: string[] } | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<NoteFolder | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(false);
  const [fatalDismissed, setFatalDismissed] = useState(false);
  const [markdownHtml, setMarkdownHtml] = useState('');
  const [mathStrokes, setMathStrokes] = useState<Stroke[] | null>(null);
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null);
  const surfaceRef = useRef<DrawingSurfaceHandle>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const toolDockRef = useRef<HTMLDivElement>(null);
  const toolOptionsRef = useRef<HTMLDivElement>(null);
  const backgroundPanelRef = useRef<HTMLDivElement>(null);
  const backgroundButtonRef = useRef<HTMLButtonElement>(null);
  const lastSaveErrorRef = useRef(false);

  useEffect(() => {
    if (folderFilter === 'all' || folderFilter === 'uncategorized') return;
    if (!store.folders.some((folder) => folder.id === folderFilter)) {
      setFolderFilter('all');
      setSelectionMode(false);
      setSelectedNoteIds(new Set());
    }
  }, [folderFilter, store.folders]);

  useEffect(() => {
    setSelectedNoteIds((previous) => {
      const valid = new Set(store.notes.map((note) => note.id));
      const next = new Set([...previous].filter((id) => valid.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [store.notes]);

  const activeNote = store.activeNote;
  const noteId = activeNote?.id;
  const readingMinutes = useMemo(() => {
    if (!activeNote?.markdown) return 0;
    const words = activeNote.markdown.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 220));
  }, [activeNote?.markdown]);

  // The Markdown renderer is a separate chunk, only requested for notes that
  // actually contain a document.
  useEffect(() => {
    let cancelled = false;
    if (!activeNote?.markdown) {
      setMarkdownHtml('');
      return;
    }
    const assets = new Map(Object.entries(activeNote.assets ?? {}));
    void import('./lib/markdown')
      .then(({ markdownToHtml }) => {
        if (!cancelled) setMarkdownHtml(markdownToHtml(activeNote.markdown, assets));
      })
      .catch((error) => {
        console.error('Could not render markdown', error);
        if (!cancelled) setMarkdownHtml('');
      });
    return () => {
      cancelled = true;
    };
  }, [activeNote?.id, activeNote?.markdown, activeNote?.assets]);

  const showToast = useCallback(
    (message: string, tone: 'neutral' | 'success' | 'error' = 'neutral') => {
      pushToast(message.startsWith('toast.') ? t(message) : message, tone);
    },
    [pushToast, t],
  );

  const closeFloatingSurfaces = useCallback(() => {
    setInspector(null);
    setBackgroundOpen(false);
  }, []);

  useClickOutside(
    [toolDockRef, toolOptionsRef],
    () => setInspector(null),
    Boolean(inspector),
  );
  useClickOutside(
    [backgroundPanelRef, backgroundButtonRef],
    () => setBackgroundOpen(false),
    backgroundOpen,
  );

  useEffect(() => {
    setSelection(null);
    setInspector(null);
    setBackgroundOpen(false);
    setSourceOpen(false);
    setHintDismissed(false);
    setSidebarOpen(false);
    setMathStrokes(null);
    setPreviewImage(null);
  }, [noteId]);

  useEffect(() => {
    if (store.saveStatus === 'error' && !lastSaveErrorRef.current) {
      lastSaveErrorRef.current = true;
      showToast(t('note.saveErrorToast'), 'error');
    }
    if (store.saveStatus !== 'error') lastSaveErrorRef.current = false;
  }, [showToast, store.saveStatus, t]);

  const createNote = useCallback(() => {
    closeFloatingSurfaces();
    setSelection(null);
    const targetFolder =
      folderFilter !== 'all' && folderFilter !== 'uncategorized' && store.folders.some((folder) => folder.id === folderFilter)
        ? folderFilter
        : null;
    const note = store.createNote({
      title: t('note.untitled'),
      background: { ...settings.defaultBackground },
      folderId: targetFolder,
    });
    if (note) setSidebarOpen(false);
    showToast(t('toast.noteCreated'), 'success');
  }, [closeFloatingSurfaces, folderFilter, settings.defaultBackground, showToast, store, t]);

  // The PWA shortcut uses ?new=1; consume it once so a refresh doesn't keep
  // creating notes.
  useEffect(() => {
    if (store.loading) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('new') !== '1') return;
    params.delete('new');
    const query = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    createNote();
  }, [store.loading, createNote]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], .modal-backdrop, .source-panel')) return;
      if (document.querySelector('.modal-backdrop')) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() === 'n' && !settingsOpen && !importOpen && !sourceOpen) {
        event.preventDefault();
        createNote();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createNote, importOpen, settingsOpen, sourceOpen]);

  const updateTool = useCallback((next: InkTool) => {
    setTool(next);
    if (next === 'lasso') setInspector(null);
  }, []);

  const handleToolSelect = (next: InkTool) => {
    setTool(next);
    if (next === 'lasso') {
      setInspector(null);
      return;
    }
    setInspector((current) => (current === next ? null : next));
  };

  const handleColorSelect = () => {
    if (tool === 'lasso') {
      setTool('pen');
      setInspector('pen');
      return;
    }
    setInspector((current) => (current === null ? (tool as ToolWithOptions) : null));
  };

  const patchSettings = useCallback(
    (patch: Partial<Settings>) => {
      settings.patch(patch);
    },
    [settings],
  );

  const updateBackground = (background: BackgroundSettings) => {
    if (!noteId) return;
    store.patchNote(noteId, { background }, { delay: 500 });
  };

  const saveBackgroundDefault = () => {
    if (!activeNote) return;
    patchSettings({ defaultBackground: { ...activeNote.background } });
    showToast(t('background.savedDefault'), 'success');
  };

  const handleStrokesChange = useCallback(
    (strokes: Note['strokes']) => {
      if (!noteId) return;
      store.patchNote(noteId, { strokes }, { delay: 700 });
    },
    [noteId, store],
  );

  const handleImagesChange = useCallback(
    (images: Note['images']) => {
      if (!noteId) return;
      store.patchNote(noteId, { images }, { delay: 700 });
    },
    [noteId, store],
  );

  const handleImportImages = async (files: FileList | null): Promise<void> => {
    if (!files?.length) return;
    const list = Array.from(files);
    if (list.length > 12) {
      showToast(t('image.tooMany'), 'error');
    }
    const capacity = Math.max(0, 40 - (activeNote?.images?.length ?? 0));
    if (!capacity) {
      showToast(t('image.limit'), 'error');
      return;
    }
    if (list.length > capacity) showToast(t('image.limit'), 'error');
    const prepared: PreparedImage[] = [];
    for (const file of list.slice(0, Math.min(12, capacity))) {
      try {
        prepared.push(await prepareImageFile(file));
      } catch (error) {
        console.error('Could not import image', error);
        showToast(t('image.failed'), 'error');
      }
    }
    if (prepared.length) {
      surfaceRef.current?.insertImages(prepared);
      showToast(t('image.imported', { count: prepared.length }), 'success');
    }
  };

  const handleSelectionChange = useCallback((next: Selection | null) => {
    setSelection(next);
    if (next) setInspector(null);
  }, []);

  const handleExportNote = async (note: Note, format: NoteExportFormat): Promise<void> => {
    if (!note || exporting) return;
    setExporting(true);
    store.flush(note.id);
    try {
      const {
        exportPdf,
        exportMarkdownFile,
        exportPngFile,
        exportSvgFile,
        exportEditableFile,
      } = await import('./lib/exporters');
      if (format === 'pdf') {
        const result = await exportPdf(note, {
          inkHeading: t('export.inkHeading'),
          page: t('export.page'),
          createdWith: t('export.createdWith'),
          emptyNote: t('export.emptyNote'),
        });
        showToast(t('export.pdfDone', { pages: result.pages }), 'success');
      } else if (format === 'markdown') {
        await exportMarkdownFile(note, {
          inkHeading: t('export.inkHeading'),
          page: t('export.page'),
          createdWith: t('export.createdWith'),
          emptyNote: t('export.emptyNote'),
        });
        showToast(t('export.markdownDone'), 'success');
      } else if (format === 'png') {
        await exportPngFile(note);
        showToast(t('export.pngDone'), 'success');
      } else if (format === 'svg') {
        exportSvgFile(note);
        showToast(t('export.svgDone'), 'success');
      } else {
        exportEditableFile(note);
        showToast(t('export.editableDone'), 'success');
      }
    } catch (error) {
      console.error(error);
      showToast(t('export.failed'), 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleImport = (notes: ImportedMarkdownNote[]) => {
    const paths = [...new Set(notes.map((note) => note.folderPath).filter(Boolean))];
    const folderMap = store.ensureFolders(paths);
    const fallbackFolder =
      folderFilter !== 'all' && folderFilter !== 'uncategorized' && store.folders.some((folder) => folder.id === folderFilter)
        ? folderFilter
        : null;
    const created = store.importNotes(
      notes.map((note) => ({
        title: note.title,
        markdown: note.markdown,
        sourcePath: note.sourcePath,
        assets: note.assets,
        folderId: note.folderPath ? folderMap.get(note.folderPath) ?? null : fallbackFolder,
        strokes: [],
        background: { ...settings.defaultBackground },
      })),
    );
    setImportOpen(false);
    setSidebarOpen(false);
    setFolderFilter('all');
    setSelectionMode(false);
    setSelectedNoteIds(new Set());
    showToast(t('import.done', { count: created.length }), 'success');
  };

  const handleImportEditable = async (files: File[]): Promise<void> => {
    const parsed: ImportedNote[] = [];
    for (const file of files.slice(0, 12)) {
      try {
        const note = parseEditableNoteJson(await file.text());
        parsed.push(note);
      } catch (error) {
        console.error('Could not import editable note', error);
        showToast(`${t('import.editableError')} ${error instanceof Error ? error.message : ''}`.trim(), 'error');
      }
    }
    if (!parsed.length) return;
    const created = store.importNotes(parsed);
    setImportOpen(false);
    setSidebarOpen(false);
    showToast(t('import.done', { count: created.length }), 'success');
  };

  const handleDeleteNote = () => {
    if (!noteToDelete) return;
    void store.deleteNote(noteToDelete.id);
    setNoteToDelete(null);
    showToast(t('toast.noteDeleted'), 'neutral');
  };

  const handleFolderSelect = (id: FolderFilter): void => {
    setFolderFilter(id);
    setSelectionMode(false);
    setSelectedNoteIds(new Set());
    const visible =
      id === 'all'
        ? store.notes
        : id === 'uncategorized'
          ? store.notes.filter((note) => !note.folderId)
          : store.notes.filter((note) => note.folderId === id);
    if (store.activeId && !visible.some((note) => note.id === store.activeId) && visible.length) {
      store.selectNote(visible[0].id);
    }
  };

  const toggleSelected = (id: string): void => {
    setSelectedNoteIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectionModeChange = (active: boolean): void => {
    setSelectionMode(active);
    if (!active) setSelectedNoteIds(new Set());
  };

  const handleDeleteSelected = (): void => {
    if (!selectedNoteIds.size) return;
    setBulkDeleteOpen(true);
  };

  const confirmDeleteSelected = async (): Promise<void> => {
    const ids = [...selectedNoteIds];
    const count = await store.deleteNotes(ids);
    setBulkDeleteOpen(false);
    setSelectionMode(false);
    setSelectedNoteIds(new Set());
    showToast(t('toast.notesDeleted', { count }), 'neutral');
  };

  const handleMoveToFolder = (targetFolderId: string | null): void => {
    if (!moveRequest) return;
    const count = store.moveNotes(moveRequest.ids, targetFolderId);
    setMoveRequest(null);
    setSelectionMode(false);
    setSelectedNoteIds(new Set());
    if (count) showToast(t('toast.notesMoved', { count }), 'success');
  };

  const openCreateFolder = (parentId: string | null): void => {
    setFolderDialog({ mode: 'create', parentId, initialName: '' });
  };

  const openRenameFolder = (folder: NoteFolder): void => {
    setFolderDialog({
      mode: 'rename',
      parentId: folder.parentId,
      folder,
      initialName: folder.name,
    });
  };

  const submitFolderName = (name: string): void => {
    if (!folderDialog) return;
    if (folderDialog.mode === 'rename' && folderDialog.folder) {
      store.renameFolder(folderDialog.folder.id, name);
      showToast(t('toast.folderRenamed'), 'success');
      return;
    }
    store.createFolder(name, folderDialog.parentId);
    showToast(t('toast.folderCreated'), 'success');
  };

  const confirmDeleteFolder = async (): Promise<void> => {
    if (!folderToDelete) return;
    const removed = collectFolderIds(store.folders, folderToDelete.id);
    const parentId = await store.deleteFolder(folderToDelete.id);
    if (removed.has(folderFilter)) setFolderFilter(parentId ?? 'uncategorized');
    setFolderToDelete(null);
    setSelectionMode(false);
    setSelectedNoteIds(new Set());
    showToast(t('toast.folderDeleted'), 'neutral');
  };

  const handleSourceApply = (markdown: string) => {
    if (!noteId) return;
    store.patchNote(noteId, { markdown }, { delay: 300 });
    setSourceOpen(false);
    showToast(t('source.applied'), 'success');
  };

  const activeHasInk = Boolean(activeNote?.strokes.some((stroke) => stroke.tool !== 'eraser'));
  const activeHasImages = Boolean(activeNote?.images?.length);
  const showEmptyHint =
    Boolean(activeNote) &&
    settings.showCanvasHints &&
    !hintDismissed &&
    !activeHasInk &&
    !activeHasImages &&
    !activeNote?.markdown;

  if (store.loading) return <AppSkeleton />;

  if (store.fatalError && !fatalDismissed) {
    return (
      <div className="fatal-screen">
        <img src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" width={72} height={72} />
        <h1>Paligraph Canvas</h1>
        <p>{t('error.storageUnavailable')}</p>
        <code>{store.fatalError}</code>
        <div className="fatal-actions">
          <button type="button" className="fluent-button" onClick={() => setFatalDismissed(true)}>{t('common.continue')}</button>
          <button type="button" className="fluent-button primary" onClick={() => window.location.reload()}>{t('common.reload')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`app-shell ${sidebarOpen ? 'sidebar-open' : ''}`.trim()}>
      <NoteSidebar
        notes={store.notes}
        folders={store.folders}
        activeId={store.activeId}
        open={sidebarOpen}
        folderId={folderFilter}
        onFolderSelect={handleFolderSelect}
        onClose={() => setSidebarOpen(false)}
        onSelect={(id) => {
          store.selectNote(id);
          setSidebarOpen(false);
        }}
        onCreate={createNote}
        onImport={() => {
          setImportOpen(true);
          setSidebarOpen(false);
        }}
        onDeleteRequest={setNoteToDelete}
        onMoveNote={(note) => setMoveRequest({ ids: [note.id] })}
        onExportNote={(note, format) => void handleExportNote(note, format)}
        onCreateFolder={openCreateFolder}
        onRenameFolder={openRenameFolder}
        onDeleteFolder={setFolderToDelete}
        selectionMode={selectionMode}
        selectedIds={selectedNoteIds}
        onSelectionModeChange={handleSelectionModeChange}
        onToggleSelected={toggleSelected}
        onSelectAll={(ids) => setSelectedNoteIds(new Set(ids))}
        onDeleteSelected={handleDeleteSelected}
        onMoveSelected={() => setMoveRequest({ ids: [...selectedNoteIds] })}
      />

      <main className="editor-shell">
        {activeNote ? (
          <>
            <EditorHeader
              note={activeNote}
              saveStatus={store.saveStatus}
              exporting={exporting}
              backgroundOpen={backgroundOpen}
              backgroundButtonRef={backgroundButtonRef}
              onTitleChange={(title) => {
                if (!noteId) return;
                store.patchNote(noteId, { title }, { delay: 450 });
              }}
              onOpenSidebar={() => setSidebarOpen(true)}
              onOpenSource={() => setSourceOpen(true)}
              onImportImages={() => imageInputRef.current?.click()}
              onToggleBackground={() => {
                setBackgroundOpen((open) => !open);
                setInspector(null);
              }}
              onOpenSettings={() => {
                closeFloatingSurfaces();
                setSettingsOpen(true);
              }}
              onExportPdf={() => void handleExportNote(activeNote, 'pdf')}
              onExportMarkdown={() => void handleExportNote(activeNote, 'markdown')}
              onExportPng={() => void handleExportNote(activeNote, 'png')}
              onExportSvg={() => void handleExportNote(activeNote, 'svg')}
              onExportEditable={() => void handleExportNote(activeNote, 'editable')}
              onNewNote={createNote}
            />

            <div className="canvas-region">
              <DrawingSurface
                key={activeNote.id}
                ref={surfaceRef}
                note={activeNote}
                tool={tool}
                theme={theme}
                settings={settings}
                markdownHtml={markdownHtml}
                markdownMeta={{
                  title: activeNote.title,
                  sourcePath: activeNote.sourcePath,
                  readingMinutes,
                }}
                gestureHint={t('gesture.active')}
                hasInk={activeHasInk || activeHasImages}
                onStrokesChange={handleStrokesChange}
                onImagesChange={handleImagesChange}
                onSelectionChange={handleSelectionChange}
                onHistoryChange={setHistory}
                onViewScaleChange={setScale}
                onToast={showToast}
                onToolChange={updateTool}
                onMathRequest={setMathStrokes}
                onImagePreview={(src, alt) => setPreviewImage({ src, alt })}
              />

              <div className="canvas-context" aria-hidden="true">
                <span className="context-dot" />
                {activeNote.sourcePath ? activeNote.sourcePath : t('canvas.infinite')}
              </div>

              {showEmptyHint ? (
                <EmptyCanvasHint
                  onImport={() => setImportOpen(true)}
                  onDismiss={() => setHintDismissed(true)}
                />
              ) : null}

              {selection ? (
                <SelectionToolbar
                  selection={selection}
                  onCopy={() => surfaceRef.current?.copySelection()}
                  onDuplicate={() => surfaceRef.current?.duplicateSelection()}
                  onRotate={() => surfaceRef.current?.rotateSelection(90)}
                  onDelete={() => surfaceRef.current?.deleteSelection()}
                  onDeselect={() => {
                    surfaceRef.current?.deselect();
                  }}
                />
              ) : null}

              <div className="docked-controls">
                <div ref={toolDockRef}>
                  <ToolDock
                    tool={tool}
                    color={tool === 'highlighter' ? settings.highlighterColor : settings.penColor}
                    canUndo={history.undo}
                    canRedo={history.redo}
                    optionsOpen={Boolean(inspector)}
                    onToolSelect={handleToolSelect}
                    onColorSelect={handleColorSelect}
                    onUndo={() => surfaceRef.current?.undo()}
                    onRedo={() => surfaceRef.current?.redo()}
                  />
                </div>
                {inspector && !selection ? (
                  <div ref={toolOptionsRef} className="tool-options-anchor">
                    <ToolOptions
                      tool={inspector}
                      settings={settings}
                      onChange={patchSettings}
                      onClose={() => setInspector(null)}
                      onClearAll={() => {
                        setInspector(null);
                        setConfirmClear(true);
                      }}
                    />
                  </div>
                ) : null}
              </div>

              <ZoomControls
                scale={scale}
                onZoomIn={() => surfaceRef.current?.zoomIn()}
                onZoomOut={() => surfaceRef.current?.zoomOut()}
                onFit={() => surfaceRef.current?.fitToContent()}
                onReset={() => surfaceRef.current?.resetView()}
              />

              {backgroundOpen ? (
                <div ref={backgroundPanelRef} className="background-panel-anchor">
                  <BackgroundPanel
                    value={activeNote.background}
                    onChange={updateBackground}
                    onReset={() => updateBackground({ ...settings.defaultBackground })}
                    onSaveDefault={saveBackgroundDefault}
                    onClose={() => setBackgroundOpen(false)}
                  />
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <LibraryEmpty
            onCreate={createNote}
            onImport={() => setImportOpen(true)}
          />
        )}
      </main>

      <SettingsDialog open={settingsOpen} notes={store.notes} onClose={() => setSettingsOpen(false)} onToast={showToast} />
      <Suspense fallback={null}>
        {importOpen ? (
          <ImportDialog
            open
            onClose={() => setImportOpen(false)}
            onImport={handleImport}
            onImportEditable={(files) => void handleImportEditable(files)}
          />
        ) : null}
      </Suspense>
      <Suspense fallback={null}>
        {mathStrokes ? (
          <MathDialog
            strokes={mathStrokes}
            onClose={() => setMathStrokes(null)}
            onToast={showToast}
          />
        ) : null}
      </Suspense>
      {activeNote ? (
        <SourcePanel
          note={activeNote}
          open={sourceOpen}
          onClose={() => setSourceOpen(false)}
          onApply={handleSourceApply}
          onExport={() => void handleExportNote(activeNote, 'markdown')}
        />
      ) : null}

      <FolderNameDialog
        open={Boolean(folderDialog)}
        mode={folderDialog?.mode ?? 'create'}
        initialName={folderDialog?.initialName ?? ''}
        parentPath={folderDialog ? folderPathName(store.folders, folderDialog.parentId) : ''}
        onClose={() => setFolderDialog(null)}
        onSubmit={submitFolderName}
      />

      <MoveToFolderDialog
        open={Boolean(moveRequest)}
        folders={store.folders}
        count={moveRequest?.ids.length ?? 0}
        onClose={() => setMoveRequest(null)}
        onMove={handleMoveToFolder}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        title={t('selection.deleteTitle')}
        body={t('selection.deleteBody', { count: selectedNoteIds.size })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        danger
        onConfirm={() => void confirmDeleteSelected()}
        onClose={() => setBulkDeleteOpen(false)}
      />

      <ConfirmDialog
        open={Boolean(folderToDelete)}
        title={t('folder.deleteTitle')}
        body={t('folder.deleteBody', { name: folderToDelete?.name ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        danger
        onConfirm={() => void confirmDeleteFolder()}
        onClose={() => setFolderToDelete(null)}
      />

      <ConfirmDialog
        open={Boolean(noteToDelete)}
        title={t('sidebar.deleteTitle')}
        body={t('sidebar.deleteBody', { title: noteToDelete?.title ?? t('note.untitled') })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        danger
        onConfirm={handleDeleteNote}
        onClose={() => setNoteToDelete(null)}
      />

      <ConfirmDialog
        open={confirmClear}
        title={t('tools.clearTitle')}
        body={t('tools.clearBody')}
        confirmLabel={t('tools.clearConfirm')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        danger
        onConfirm={() => {
          surfaceRef.current?.clearCanvas();
          showToast(t('tools.cleared'), 'success');
        }}
        onClose={() => setConfirmClear(false)}
      />

      {previewImage ? (
        <ImagePreviewDialog src={previewImage.src} alt={previewImage.alt} onClose={() => setPreviewImage(null)} />
      ) : null}

      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"
        multiple
        hidden
        onChange={(event) => {
          void handleImportImages(event.currentTarget.files);
          event.currentTarget.value = '';
        }}
      />

      <ToastHost toasts={toasts} onDismiss={dismissToast} dismissLabel={t('common.dismiss')} />
    </div>
  );
}
