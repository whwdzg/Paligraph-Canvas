import { ArrowFit24Regular, Target24Regular, ZoomIn24Regular, ZoomOut24Regular } from '@fluentui/react-icons';
import { useI18n } from '../../i18n/I18nProvider';

interface ZoomControlsProps {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onReset: () => void;
}

export function ZoomControls({ scale, onZoomIn, onZoomOut, onFit, onReset }: ZoomControlsProps) {
  const { t } = useI18n();
  return (
    <div className="zoom-controls glass-surface" role="group" aria-label={t('zoom.label')}>
      <button type="button" onClick={onZoomOut} aria-label={t('zoom.out')} data-tooltip={t('zoom.out')}>
        <ZoomOut24Regular />
      </button>
      <button type="button" className="zoom-value" onClick={onReset} aria-label={t('zoom.reset')} data-tooltip={t('zoom.reset')}>
        {Math.round(scale * 100)}%
      </button>
      <button type="button" onClick={onZoomIn} aria-label={t('zoom.in')} data-tooltip={t('zoom.in')}>
        <ZoomIn24Regular />
      </button>
      <span className="zoom-divider" aria-hidden="true" />
      <button type="button" onClick={onFit} aria-label={t('zoom.fit')} data-tooltip={t('zoom.fit')}>
        <ArrowFit24Regular />
      </button>
      <button type="button" className="zoom-center" onClick={onReset} aria-label={t('zoom.center')} data-tooltip={t('zoom.center')}>
        <Target24Regular />
      </button>
    </div>
  );
}
