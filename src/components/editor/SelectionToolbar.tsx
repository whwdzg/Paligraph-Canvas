import {
  ArrowRotateClockwise24Regular,
  Copy24Regular,
  Delete24Regular,
  Dismiss24Regular,
  DocumentCopy24Regular,
} from '@fluentui/react-icons';
import { useI18n } from '../../i18n/I18nProvider';
import type { Selection } from '../../lib/types';

interface SelectionToolbarProps {
  selection: Selection;
  onDuplicate: () => void;
  onCopy: () => void;
  onRotate: () => void;
  onDelete: () => void;
  onDeselect: () => void;
}

export function SelectionToolbar({ selection, onDuplicate, onCopy, onRotate, onDelete, onDeselect }: SelectionToolbarProps) {
  const { t } = useI18n();
  return (
    <div className="selection-toolbar glass-surface" role="toolbar" aria-label={t('selection.label')}>
      <span className="selection-count">{t('selection.count', { count: selection.ids.length + selection.imageIds.length })}</span>
      <span className="selection-hint">{t('selection.dragHint')}</span>
      <span className="dock-divider" aria-hidden="true" />
      <button type="button" className="selection-action" onClick={onCopy} aria-label={t('selection.copy')} data-tooltip={t('selection.copy')}>
        <Copy24Regular />
      </button>
      <button type="button" className="selection-action" onClick={onDuplicate} aria-label={t('selection.duplicate')} data-tooltip={t('selection.duplicate')}>
        <DocumentCopy24Regular />
      </button>
      <button type="button" className="selection-action" onClick={onRotate} aria-label={t('selection.rotate')} data-tooltip={t('selection.rotate')}>
        <ArrowRotateClockwise24Regular />
      </button>
      <button type="button" className="selection-action is-danger" onClick={onDelete} aria-label={t('selection.delete')} data-tooltip={t('selection.delete')}>
        <Delete24Regular />
      </button>
      <button type="button" className="selection-action" onClick={onDeselect} aria-label={t('selection.deselect')} data-tooltip={t('selection.deselect')}>
        <Dismiss24Regular />
      </button>
    </div>
  );
}
