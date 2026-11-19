import { ArrowImport24Regular, Dismiss24Regular, DrawShape24Regular, Sparkle24Regular } from '@fluentui/react-icons';
import { useI18n } from '../../i18n/I18nProvider';

interface EmptyCanvasHintProps {
  onImport: () => void;
  onDismiss: () => void;
}

/** A quiet first-run nudge; vanishes as soon as ink appears. */
export function EmptyCanvasHint({ onImport, onDismiss }: EmptyCanvasHintProps) {
  const { t } = useI18n();
  return (
    <div className="empty-canvas-hint">
      <button type="button" className="hint-dismiss" onClick={onDismiss} aria-label={t('empty.dismiss')}>
        <Dismiss24Regular />
      </button>
      <span className="empty-hint-mark" aria-hidden="true"><Sparkle24Regular /></span>
      <h2>{t('empty.title')}</h2>
      <p>{t('empty.body')}</p>
      <div className="empty-hint-actions">
        <span className="empty-shortcut"><DrawShape24Regular /> {t('empty.drawHint')}</span>
        <button type="button" className="text-button" onClick={onImport}>
          <ArrowImport24Regular /> {t('empty.importHint')}
        </button>
      </div>
    </div>
  );
}
