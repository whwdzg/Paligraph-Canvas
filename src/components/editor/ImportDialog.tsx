import { useEffect, useRef, useState, type DragEvent } from 'react';
import {
  ArrowImport24Regular,
  ArrowSync24Regular,
  DocumentText24Regular,
  FolderOpen24Regular,
} from '@fluentui/react-icons';
import { useI18n } from '../../i18n/I18nProvider';
import {
  filesFromDataTransfer,
  filesFromList,
  scanVault,
  type ImportedMarkdownNote,
  type VaultFile,
  type VaultScanProgress,
  type VaultScanResult,
} from '../../lib/obsidian';
import { Modal } from '../common/Modal';

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: (notes: ImportedMarkdownNote[]) => void;
}

type Phase = 'idle' | 'scanning' | 'ready' | 'error';

export function ImportDialog({ open, onClose, onImport }: ImportDialogProps) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<VaultScanResult | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<VaultScanProgress | null>(null);
  const [dragging, setDragging] = useState(false);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    if (!open) return;
    setPhase('idle');
    setResult(null);
    setError('');
    setProgress(null);
    setDragging(false);
    dragDepth.current = 0;
    const folderInput = folderInputRef.current;
    if (folderInput) {
      folderInput.setAttribute('webkitdirectory', '');
      folderInput.setAttribute('directory', '');
    }
  }, [open]);

  const processFiles = async (files: VaultFile[]): Promise<void> => {
    if (!files.length) return;
    setPhase('scanning');
    setError('');
    setResult(null);
    try {
      const scanned = await scanVault(files, setProgress);
      if (!scanned.notes.length) {
        setPhase('error');
        setError(t('import.noMarkdown'));
        return;
      }
      setResult(scanned);
      setPhase('ready');
    } catch (reason) {
      setPhase('error');
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setProgress(null);
    }
  };

  const takeInput = (input: HTMLInputElement | null): void => {
    if (!input) return;
    const files = input.files;
    if (!files?.length) return;
    void processFiles(filesFromList(files));
    input.value = '';
  };

  const onDrop = async (event: DragEvent<HTMLDivElement>): Promise<void> => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (phase === 'scanning') return;
    const transfer = event.dataTransfer;
    if (transfer.items?.length) {
      const files = await filesFromDataTransfer(transfer.items);
      await processFiles(files);
    } else {
      await processFiles(filesFromList(transfer.files));
    }
  };

  const ready = phase === 'ready' && result;
  const importLabel = ready
    ? t('import.importCount', { count: result.notes.length })
    : t('import.action');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('import.title')}
      eyebrow={t('import.eyebrow')}
      closeLabel={t('common.close')}
      size="lg"
      className="import-modal"
      dismissible={phase !== 'scanning'}
      footer={
        <>
          <button type="button" className="fluent-button" onClick={onClose} disabled={phase === 'scanning'}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="fluent-button primary"
            disabled={!ready}
            onClick={() => {
              if (result) onImport(result.notes);
            }}
          >
            <ArrowImport24Regular />
            {importLabel}
          </button>
        </>
      }
    >
      <div
        className={`import-body ${dragging ? 'is-dragging' : ''}`.trim()}
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={(event) => void onDrop(event)}
      >
        {phase === 'idle' || phase === 'error' ? (
          <>
            <div className="import-hero">
              <span className="import-hero-icon"><ArrowImport24Regular /></span>
              <div>
                <h3>{t('import.dropTitle')}</h3>
                <p>{t('import.dropHint')}</p>
              </div>
            </div>
            <div className="import-choices">
              <button type="button" className="import-choice" onClick={() => folderInputRef.current?.click()}>
                <span className="import-choice-icon"><FolderOpen24Regular /></span>
                <span>
                  <strong>{t('import.folder')}</strong>
                  <small>{t('import.folderHint')}</small>
                </span>
              </button>
              <button type="button" className="import-choice" onClick={() => filesInputRef.current?.click()}>
                <span className="import-choice-icon"><DocumentText24Regular /></span>
                <span>
                  <strong>{t('import.files')}</strong>
                  <small>{t('import.filesHint')}</small>
                </span>
              </button>
            </div>
            <p className="import-note">{t('import.localNote')}</p>
            {error ? <p className="import-error" role="alert">{error}</p> : null}
          </>
        ) : null}

        {phase === 'scanning' ? (
          <div className="import-progress" aria-live="polite">
            <span className="import-spinner" aria-hidden="true"><ArrowSync24Regular /></span>
            <div>
              <strong>{t('import.scanning')}</strong>
              <p>{progress?.label ?? t('import.scanningHint')}</p>
              {progress ? (
                <span>{progress.current} / {progress.total}</span>
              ) : null}
            </div>
          </div>
        ) : null}

        {ready ? (
          <div className="import-result">
            <div className="import-summary">
              <span className="import-summary-number">{result.notes.length}</span>
              <div>
                <strong>{t('import.found', { count: result.notes.length })}</strong>
                <span>
                  {t('import.summary', {
                    total: result.totalFiles,
                    assets: result.assets,
                  })}
                </span>
              </div>
            </div>
            {result.truncated ? <p className="import-warning">{t('import.truncated', { max: 240 })}</p> : null}
            <div className="import-file-list">
              {result.notes.slice(0, 12).map((note) => (
                <div key={note.sourcePath} className="import-file">
                  <DocumentText24Regular />
                  <span>
                    <strong>{note.title}</strong>
                    <small>{note.sourcePath}</small>
                  </span>
                  {Object.keys(note.assets).length ? (
                    <span className="import-asset-count">{t('import.assets', { count: Object.keys(note.assets).length })}</span>
                  ) : null}
                </div>
              ))}
              {result.notes.length > 12 ? (
                <p className="import-more">{t('import.more', { count: result.notes.length - 12 })}</p>
              ) : null}
            </div>
            <p className="import-note">{t('import.readyHint')}</p>
          </div>
        ) : null}

        {dragging ? <div className="drop-overlay">{t('import.dropActive')}</div> : null}
      </div>

      <input
        ref={filesInputRef}
        type="file"
        accept=".md,.markdown,.mdown,text/markdown"
        multiple
        hidden
        onChange={(event) => takeInput(event.currentTarget)}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => takeInput(event.currentTarget)}
      />
    </Modal>
  );
}
