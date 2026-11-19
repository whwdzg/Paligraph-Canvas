import { useEffect, useRef, useState } from 'react';
import { FolderAdd24Regular, Rename24Regular } from '@fluentui/react-icons';
import { useI18n } from '../../i18n/I18nProvider';
import { Modal } from '../common/Modal';

interface FolderNameDialogProps {
  open: boolean;
  mode: 'create' | 'rename';
  initialName: string;
  parentPath: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
}

export function FolderNameDialog({
  open,
  mode,
  initialName,
  parentPath,
  onClose,
  onSubmit,
}: FolderNameDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    const timer = window.setTimeout(() => inputRef.current?.select(), 40);
    return () => window.clearTimeout(timer);
  }, [initialName, open]);

  const submit = (): void => {
    const clean = name.trim();
    if (!clean) {
      inputRef.current?.focus();
      return;
    }
    onSubmit(clean);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'create' ? t('folder.createTitle') : t('folder.renameTitle')}
      closeLabel={t('common.close')}
      size="sm"
      footer={
        <>
          <button type="button" className="fluent-button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="fluent-button primary" onClick={submit} disabled={!name.trim()}>
            {mode === 'create' ? <FolderAdd24Regular /> : <Rename24Regular />}
            {mode === 'create' ? t('folder.create') : t('folder.rename')}
          </button>
        </>
      }
    >
      <div className="folder-dialog-body">
        <label className="folder-name-field">
          <span>{t('folder.name')}</span>
          <input
            ref={inputRef}
            value={name}
            maxLength={80}
            autoFocus
            placeholder={t('folder.namePlaceholder')}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
            }}
          />
        </label>
        <p className="folder-dialog-hint">
          {parentPath
            ? t('folder.parentHint', { path: parentPath })
            : t('folder.rootHint')}
        </p>
      </div>
    </Modal>
  );
}
