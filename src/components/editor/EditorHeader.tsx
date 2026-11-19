import { useMemo, useRef, useState, type Ref } from 'react';
import {
  Add24Regular,
  ArrowDownload24Regular,
  CheckmarkCircle24Regular,
  ChevronDown24Regular,
  Code24Regular,
  DocumentPdf24Regular,
  DocumentText24Regular,
  Grid24Regular,
  Image24Regular,
  ImageAdd24Regular,
  Navigation24Regular,
  Save24Regular,
  Settings24Regular,
  Warning24Regular,
} from '@fluentui/react-icons';
import { useI18n } from '../../i18n/I18nProvider';
import { formatFullDate } from '../../lib/format';
import type { Note } from '../../lib/types';
import type { SaveStatus } from '../../hooks/useNotes';
import { useClickOutside } from '../../hooks/useClickOutside';
import { IconButton } from '../common/IconButton';

interface EditorHeaderProps {
  note: Note;
  saveStatus: SaveStatus;
  exporting: boolean;
  backgroundOpen: boolean;
  backgroundButtonRef?: Ref<HTMLButtonElement>;
  onTitleChange: (title: string) => void;
  onOpenSidebar: () => void;
  onOpenSource: () => void;
  onImportImages: () => void;
  onToggleBackground: () => void;
  onOpenSettings: () => void;
  onExportPdf: () => void;
  onExportMarkdown: () => void;
  onExportPng: () => void;
  onExportSvg: () => void;
  onExportEditable: () => void;
  onNewNote: () => void;
}

export function EditorHeader({
  note,
  saveStatus,
  exporting,
  backgroundOpen,
  backgroundButtonRef,
  onTitleChange,
  onOpenSidebar,
  onOpenSource,
  onImportImages,
  onToggleBackground,
  onOpenSettings,
  onExportPdf,
  onExportMarkdown,
  onExportPng,
  onExportSvg,
  onExportEditable,
  onNewNote,
}: EditorHeaderProps) {
  const { t, language } = useI18n();
  const [exportOpen, setExportOpen] = useState(false);
  const exportButtonRef = useRef<HTMLButtonElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const outsideRefs = useMemo(() => [exportButtonRef, exportMenuRef], []);
  useClickOutside(outsideRefs, () => setExportOpen(false), exportOpen);

  return (
    <header className="editor-header">
      <div className="editor-title-area">
        <button type="button" className="icon-button mobile-sidebar-button" onClick={onOpenSidebar} aria-label={t('sidebar.open')}>
          <Navigation24Regular />
        </button>
        <div className="title-stack">
          <input
            className="note-title-input"
            value={note.title}
            placeholder={t('note.untitled')}
            aria-label={t('note.title')}
            maxLength={160}
            onChange={(event) => onTitleChange(event.target.value)}
            onBlur={(event) => {
              if (!event.target.value.trim()) onTitleChange(t('note.untitled'));
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
            spellCheck={false}
          />
          <span className={`save-state save-${saveStatus}`.trim()} aria-live="polite">
            {saveStatus === 'saving' ? <span className="save-spinner" aria-hidden="true" /> : null}
            {saveStatus === 'saved' ? <CheckmarkCircle24Regular aria-hidden="true" /> : null}
            {saveStatus === 'error' ? <Warning24Regular aria-hidden="true" /> : null}
            {saveStatus === 'saving'
              ? t('note.saving')
              : saveStatus === 'error'
                ? t('note.saveError')
                : t('note.saved')}
            <span className="save-separator" aria-hidden="true">·</span>
            <span className="save-date">{formatFullDate(note.updatedAt, language)}</span>
          </span>
        </div>
      </div>

      <div className="editor-actions">
        {note.markdown ? (
          <IconButton label={t('source.open')} onClick={onOpenSource} tip="bottom">
            <Code24Regular />
          </IconButton>
        ) : null}
        <IconButton label={t('image.import')} onClick={onImportImages} tip="bottom">
          <ImageAdd24Regular />
        </IconButton>
        <IconButton
          ref={backgroundButtonRef}
          label={t('background.title')}
          onClick={onToggleBackground}
          tip="bottom"
          variant={backgroundOpen ? 'soft' : 'ghost'}
          aria-expanded={backgroundOpen}
        >
          <Grid24Regular />
        </IconButton>
        <div className="export-wrap">
          <button
            ref={exportButtonRef}
            type="button"
            className={`export-button ${exportOpen ? 'is-open' : ''}`.trim()}
            onClick={() => setExportOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={exportOpen}
          >
            <ArrowDownload24Regular />
            <span>{t('export.label')}</span>
            <ChevronDown24Regular className="export-chevron" />
          </button>
          {exportOpen ? (
            <div ref={exportMenuRef} className="export-menu glass-surface" role="menu">
              <button
                type="button"
                role="menuitem"
                disabled={exporting}
                onClick={() => {
                  setExportOpen(false);
                  onExportPdf();
                }}
              >
                <span className="export-icon is-pdf"><DocumentPdf24Regular /></span>
                <span>
                  <strong>{t('export.pdf')}</strong>
                  <small>{t('export.pdfHint')}</small>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={exporting}
                onClick={() => {
                  setExportOpen(false);
                  onExportMarkdown();
                }}
              >
                <span className="export-icon is-md"><DocumentText24Regular /></span>
                <span>
                  <strong>{t('export.markdown')}</strong>
                  <small>{t('export.markdownHint')}</small>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={exporting}
                onClick={() => {
                  setExportOpen(false);
                  onExportPng();
                }}
              >
                <span className="export-icon is-image"><Image24Regular /></span>
                <span>
                  <strong>{t('export.png')}</strong>
                  <small>{t('export.pngHint')}</small>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={exporting}
                onClick={() => {
                  setExportOpen(false);
                  onExportSvg();
                }}
              >
                <span className="export-icon is-svg"><Code24Regular /></span>
                <span>
                  <strong>{t('export.svg')}</strong>
                  <small>{t('export.svgHint')}</small>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={exporting}
                onClick={() => {
                  setExportOpen(false);
                  onExportEditable();
                }}
              >
                <span className="export-icon is-editable"><Save24Regular /></span>
                <span>
                  <strong>{t('export.editable')}</strong>
                  <small>{t('export.editableHint')}</small>
                </span>
              </button>
            </div>
          ) : null}
        </div>
        <IconButton label={t('settings.title')} onClick={onOpenSettings} tip="bottom">
          <Settings24Regular />
        </IconButton>
        <button type="button" className="header-new-note" onClick={onNewNote} aria-label={t('sidebar.newNote')} title={t('sidebar.newNote')}>
          <Add24Regular />
        </button>
      </div>
    </header>
  );
}
