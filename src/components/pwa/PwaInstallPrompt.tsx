import { Dismiss24Regular, ArrowDownload24Regular } from '@fluentui/react-icons';
import { useI18n } from '../../i18n/I18nProvider';
import type { PwaInstallController } from '../../hooks/usePwaInstall';

interface PwaInstallPromptProps {
  pwa: PwaInstallController;
  onInstall: () => void;
  onGuide: () => void;
  onDismiss: () => void;
}

export function PwaInstallPrompt({ pwa, onInstall, onGuide, onDismiss }: PwaInstallPromptProps) {
  const { t } = useI18n();
  if (pwa.installed) return null;
  return (
    <div className="pwa-sidebar-card">
      <div className="pwa-sidebar-head">
        <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" width={30} height={30} />
        <div>
          <strong>{t('pwa.promptTitle')}</strong>
          <span>{pwa.canInstall ? t('pwa.promptBody') : t('pwa.iosPromptBody')}</span>
        </div>
        <button type="button" className="pwa-dismiss" aria-label={t('pwa.later')} title={t('pwa.later')} onClick={onDismiss}>
          <Dismiss24Regular />
        </button>
      </div>
      <button
        type="button"
        className="fluent-button primary pwa-prompt-action"
        onClick={pwa.canInstall ? onInstall : onGuide}
      >
        <ArrowDownload24Regular />
        {pwa.canInstall ? t('pwa.install') : t('pwa.howTo')}
      </button>
    </div>
  );
}
