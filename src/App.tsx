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
import { SettingsDialog } from './components/settings/SettingsDialog';
import { ConfirmDialog } from './components/common/ConfirmDialog';
import { ToastHost } from './components/common/ToastHost';
import { useI18n } from './i18n/I18nProvider';
import { useNotes } from './hooks/useNotes';
import { useThemeSync } from './hooks/useTheme';
import { useToasts } from './hooks/useToasts';
import { useClickOutside } from './hooks/useClickOutside';
import type { BackgroundSettings, InkTool, Note, Selection, Settings, Stroke } from './lib/types';
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
  const [confirmClear, setConfirmClear] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(false);
  const [fatalDismissed, setFatalDismissed] = useState(false);
  const [markdownHtml, setMarkdownHtml] = useState('');
  const [mathStrokes, setMathStrokes] = useState<Stroke[] | null>(null);
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null);
  const surfaceRef = useRef<DrawingSurfaceHandle>(null);
  const toolDockRef = useRef<HTMLDivElement>(null);
  const toolOptionsRef = useRef<HTMLDivElement>(null);
  const backgroundPanelRef = useRef<HTMLDivElement>(null);
  const backgroundButtonRef = useRef<HTMLButtonElement>(null);
  const lastSaveErrorRef = useRef(false);

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
    const note = store.createNote({
      title: t('note.untitled'),
      background: { ...settings.defaultBackground },
    });
    if (note) setSidebarOpen(false);
    showToast(t('toast.noteCreated'), 'success');
  }, [closeFloatingSurfaces, settings.defaultBackground, showToast, store, t]);

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

  const handleSelectionChange = useCallback((next: Selection | null) => {
    setSelection(next);
    if (next) setInspector(null);
  }, []);

  const handleExportPdf = async () => {
    if (!activeNote || exporting) return;
    setExporting(true);
    store.flush(activeNote.id);
    try {
      const { exportPdf } = await import('./lib/exporters');
      const result = await exportPdf(activeNote, {
        inkHeading: t('export.inkHeading'),
        page: t('export.page'),
        createdWith: t('export.createdWith'),
        emptyNote: t('export.emptyNote'),
      });
      showToast(t('export.pdfDone', { pages: result.pages }), 'success');
    } catch (error) {
      console.error(error);
      showToast(t('export.failed'), 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleExportMarkdown = async () => {
    if (!activeNote) return;
    try {
      const { exportMarkdownFile } = await import('./lib/exporters');
      exportMarkdownFile(activeNote, {
        inkHeading: t('export.inkHeading'),
        page: t('export.page'),
        createdWith: t('export.createdWith'),
        emptyNote: t('export.emptyNote'),
      });
      showToast(t('export.markdownDone'), 'success');
    } catch (error) {
      console.error(error);
      showToast(t('export.failed'), 'error');
    }
  };

  const handleImport = (notes: ImportedMarkdownNote[]) => {
    const created = store.importNotes(
      notes.map((note) => ({
        title: note.title,
        markdown: note.markdown,
        sourcePath: note.sourcePath,
        assets: note.assets,
        strokes: [],
        background: { ...settings.defaultBackground },
      })),
    );
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

  const handleSourceApply = (markdown: string) => {
    if (!noteId) return;
    store.patchNote(noteId, { markdown }, { delay: 300 });
    setSourceOpen(false);
    showToast(t('source.applied'), 'success');
  };

  const activeHasInk = Boolean(activeNote?.strokes.some((stroke) => stroke.tool !== 'eraser'));
  const showEmptyHint =
    Boolean(activeNote) &&
    settings.showCanvasHints &&
    !hintDismissed &&
    !activeHasInk &&
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
        activeId={store.activeId}
        open={sidebarOpen}
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
              onToggleBackground={() => {
                setBackgroundOpen((open) => !open);
                setInspector(null);
              }}
              onOpenSettings={() => {
                closeFloatingSurfaces();
                setSettingsOpen(true);
              }}
              onExportPdf={() => void handleExportPdf()}
              onExportMarkdown={() => void handleExportMarkdown()}
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
                hasInk={activeHasInk}
                onStrokesChange={handleStrokesChange}
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

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} onToast={showToast} />
      <Suspense fallback={null}>
        {importOpen ? (
          <ImportDialog open onClose={() => setImportOpen(false)} onImport={handleImport} />
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
          onExport={() => void handleExportMarkdown()}
        />
      ) : null}

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

      <ToastHost toasts={toasts} onDismiss={dismissToast} dismissLabel={t('common.dismiss')} />
    </div>
  );
}
