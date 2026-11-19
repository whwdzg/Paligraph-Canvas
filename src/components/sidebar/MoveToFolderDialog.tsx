import { useMemo } from 'react';
import { Folder24Regular, FolderArrowRight24Regular, Home24Regular } from '@fluentui/react-icons';
import { useI18n } from '../../i18n/I18nProvider';
import { buildFolderTree, flattenFolderTree } from '../../lib/folders';
import type { NoteFolder } from '../../lib/types';
import { Modal } from '../common/Modal';

interface MoveToFolderDialogProps {
  open: boolean;
  folders: NoteFolder[];
  count: number;
  onClose: () => void;
  onMove: (folderId: string | null) => void;
}

export function MoveToFolderDialog({ open, folders, count, onClose, onMove }: MoveToFolderDialogProps) {
  const { t } = useI18n();
  const flat = useMemo(() => flattenFolderTree(buildFolderTree(folders, [])), [folders]);

  const choose = (folderId: string | null): void => {
    onMove(folderId);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('folder.moveTitle', { count })}
      closeLabel={t('common.close')}
      size="sm"
      footer={
        <button type="button" className="fluent-button" onClick={onClose}>
          {t('common.cancel')}
        </button>
      }
    >
      <div className="folder-picker" role="listbox" aria-label={t('folder.moveTitle', { count })}>
        <button type="button" className="folder-picker-row" role="option" onClick={() => choose(null)}>
          <Home24Regular />
          <span>
            <strong>{t('folder.root')}</strong>
            <small>{t('folder.rootHint')}</small>
          </span>
        </button>
        {flat.map((folder) => (
          <button
            key={folder.id}
            type="button"
            className="folder-picker-row"
            role="option"
            style={{ paddingLeft: `${13 + folder.depth * 16}px` }}
            onClick={() => choose(folder.id)}
          >
            <Folder24Regular />
            <span>
              <strong>{folder.name}</strong>
              {folder.depth ? <small>{folder.path}</small> : null}
            </span>
          </button>
        ))}
        {!flat.length ? (
          <div className="folder-picker-empty">
            <FolderArrowRight24Regular />
            <p>{t('folder.emptyPicker')}</p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
