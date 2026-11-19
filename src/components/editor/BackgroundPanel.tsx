import { Dismiss24Regular, Save24Regular } from '@fluentui/react-icons';
import { useI18n } from '../../i18n/I18nProvider';
import type { BackgroundSettings } from '../../lib/types';
import { BackgroundControls } from './BackgroundControls';

interface BackgroundPanelProps {
  value: BackgroundSettings;
  onChange: (background: BackgroundSettings) => void;
  onReset: () => void;
  onSaveDefault: () => void;
  onClose: () => void;
}

export function BackgroundPanel({ value, onChange, onReset, onSaveDefault, onClose }: BackgroundPanelProps) {
  const { t } = useI18n();
  return (
    <section className="background-panel glass-surface" aria-label={t('background.title')}>
      <header className="options-header">
        <div>
          <span className="options-eyebrow">{t('background.notePaper')}</span>
          <h3>{t('background.title')}</h3>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={t('common.close')}>
          <Dismiss24Regular />
        </button>
      </header>
      <BackgroundControls value={value} onChange={onChange} onReset={onReset} />
      <button type="button" className="save-default-button" onClick={onSaveDefault}>
        <Save24Regular />
        {t('background.saveDefault')}
      </button>
    </section>
  );
}
