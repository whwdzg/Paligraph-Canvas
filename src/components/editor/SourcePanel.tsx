import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownload24Regular, Dismiss24Regular, DocumentText24Regular, Save24Regular } from '@fluentui/react-icons';
import { useI18n } from '../../i18n/I18nProvider';
import type { Note } from '../../lib/types';

interface SourcePanelProps {
  note: Note;
  open: boolean;
  onClose: () => void;
  onApply: (markdown: string) => void;
  onExport: () => void;
}

/**
 * Markdown source drawer. Imported notes stay lossless: the original vault
 * source is editable here while the canvas shows a rendered reading card.
 */
export function SourcePanel({ note, open, onClose, onApply, onExport }: SourcePanelProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(note.markdown);
  const returnFocusRef = useRef<Element | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dirty = draft !== note.markdown;

  useEffect(() => {
    if (!open) return;
    setDraft(note.markdown);
    returnFocusRef.current = document.activeElement;
    window.setTimeout(() => textareaRef.current?.focus(), 30);
    return () => {
      if (returnFocusRef.current instanceof HTMLElement) returnFocusRef.current.focus();
    };
    // Reset only when the sheet opens or switches note.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, note.id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        onApply(draft);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft, onApply, onClose, open]);

  const readingMinutes = useMemo(() => {
    const words = draft.trim() ? draft.trim().split(/\s+/).length : 0;
    return Math.max(1, Math.round(words / 220));
  }, [draft]);

  if (!open) return null;

  return createPortal(
    <>
      <div className="source-scrim" onPointerDown={onClose} />
      <aside className="source-panel glass-surface" role="dialog" aria-modal="true" aria-label={t('source.title')}>
        <header className="source-header">
          <span className="source-icon"><DocumentText24Regular /></span>
          <div>
            <span className="options-eyebrow">{t('source.eyebrow')}</span>
            <h2>{t('source.title')}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('common.close')}>
            <Dismiss24Regular />
          </button>
        </header>
        {note.sourcePath ? <p className="source-path">{note.sourcePath}</p> : null}
        <div className="source-meta">
          <span>{t('source.words', { count: draft.trim() ? draft.trim().split(/\s+/).length : 0 })}</span>
          <span>{t('source.readingTime', { count: readingMinutes })}</span>
          {dirty ? <span className="source-dirty">{t('source.unsaved')}</span> : null}
        </div>
        <textarea
          ref={textareaRef}
          className="source-editor"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          spellCheck={false}
          aria-label={t('source.title')}
        />
        <footer className="source-footer">
          <button type="button" className="fluent-button" onClick={onExport}>
            <ArrowDownload24Regular />
            {t('export.markdown')}
          </button>
          <span className="source-footer-spacer" />
          <button type="button" className="fluent-button" onClick={onClose}>{t('common.cancel')}</button>
          <button
            type="button"
            className="fluent-button primary"
            disabled={!dirty}
            onClick={() => onApply(draft)}
          >
            <Save24Regular />
            {t('source.apply')}
          </button>
        </footer>
      </aside>
    </>,
    document.body,
  );
}
