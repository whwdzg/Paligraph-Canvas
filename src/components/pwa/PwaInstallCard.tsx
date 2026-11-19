import { CheckmarkCircle24Regular, ArrowDownload24Regular } from '@fluentui/react-icons';
import { useI18n } from '../../i18n/I18nProvider';
import type { PwaInstallController } from '../../hooks/usePwaInstall';

interface PwaInstallCardProps {
  pwa: PwaInstallController;
  onInstall: () => void;
}

export function PwaInstallCard({ pwa, onInstall }: PwaInstallCardProps) {
  const { t } = useI18n();
  return (
    <div className="pwa-settings-card">
      <div className="pwa-settings-head">
        <span className="pwa-settings-icon">
          <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" width={38} height={38} />
        </span>
        <div className="pwa-settings-copy">
          <strong>{pwa.installed ? t('pwa.installed') : t('pwa.title')}</strong>
          <span>
            {pwa.installed
              ? t('pwa.installedBody')
              : pwa.canInstall
                ? t('pwa.available')
                : pwa.isIos
                  ? t('pwa.iosAvailable')
                  : t('pwa.manualAvailable')}
          </span>
        </div>
        {pwa.installed ? (
          <span className="pwa-installed-chip">
            <CheckmarkCircle24Regular />
            {t('pwa.installedShort')}
          </span>
        ) : pwa.canInstall ? (
          <button type="button" className="fluent-button primary" onClick={onInstall}>
            <ArrowDownload24Regular />
            {t('pwa.install')}
          </button>
        ) : null}
      </div>
      {!pwa.installed && !pwa.canInstall ? (
        <div className="pwa-steps">
          {pwa.isIos ? (
            <>
              <span className="pwa-step"><b>1</b>{t('pwa.iosStep1')}</span>
              <span className="pwa-step"><b>2</b>{t('pwa.iosStep2')}</span>
              <span className="pwa-step"><b>3</b>{t('pwa.iosStep3')}</span>
            </>
          ) : (
            <>
              <span className="pwa-step"><b>1</b>{t('pwa.desktopStep1')}</span>
              <span className="pwa-step"><b>2</b>{t('pwa.desktopStep2')}</span>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
