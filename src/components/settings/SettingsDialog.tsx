import { useMemo, useRef, useState } from 'react';
import {
  ArrowDownload24Regular,
  ArrowUpload24Regular,
  CheckmarkCircle24Regular,
  Code24Regular,
  Color24Regular,
  Copy24Regular,
  Database24Regular,
  Desktop24Regular,
  Globe24Regular,
  Info24Regular,
  LocalLanguage24Regular,
  PaintBrush24Regular,
  Settings24Regular,
  WeatherMoon24Regular,
  WeatherSunny24Regular,
} from '@fluentui/react-icons';
import { useI18n } from '../../i18n/I18nProvider';
import { APP_VERSION } from '../../config/palette';
import {
  defaultSettingsDocument,
  parseSettingsJson,
  serializeSettings,
  SETTINGS_JSON_VERSION,
} from '../../lib/settingsJson';
import { parseLanguagePackJson } from '../../lib/languagePacks';
import { downloadBlob, safeFilename } from '../../lib/download';
import { useSettingsStore } from '../../state/settings';
import type { ThemeChoice } from '../../lib/types';
import { Modal } from '../common/Modal';
import { Switch } from '../common/Switch';
import { Segmented } from '../common/Segmented';
import { Slider } from '../common/Slider';
import { BackgroundControls } from '../editor/BackgroundControls';

type SettingsTab = 'appearance' | 'canvas' | 'language' | 'data' | 'about';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  onToast: (message: string, tone?: 'neutral' | 'success' | 'error') => void;
}

const TABS: Array<{ id: SettingsTab; icon: typeof Settings24Regular; labelKey: string }> = [
  { id: 'appearance', icon: Color24Regular, labelKey: 'settings.appearance' },
  { id: 'canvas', icon: PaintBrush24Regular, labelKey: 'settings.canvas' },
  { id: 'language', icon: LocalLanguage24Regular, labelKey: 'settings.language' },
  { id: 'data', icon: Database24Regular, labelKey: 'settings.data' },
  { id: 'about', icon: Info24Regular, labelKey: 'settings.about' },
];

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="setting-row">
      <div className="setting-copy">
        <strong>{title}</strong>
        {description ? <span>{description}</span> : null}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="settings-section-heading">
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
    </div>
  );
}

export function SettingsDialog({ open, onClose, onToast }: SettingsDialogProps) {
  const { t, languages, preference, setLanguage, importLanguagePack } = useI18n();
  const settings = useSettingsStore();
  const { patch, replaceSettings, resetSettings } = settings;
  const [tab, setTab] = useState<SettingsTab>('appearance');
  const [settingsError, setSettingsError] = useState('');
  const [languageError, setLanguageError] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const settingsInputRef = useRef<HTMLInputElement>(null);
  const languageInputRef = useRef<HTMLInputElement>(null);

  const settingsJson = useMemo(() => serializeSettings(settings), [settings]);

  const copySettings = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(settingsJson);
      setCopied(true);
      onToast(t('data.copied'), 'success');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setSettingsError(t('data.copyFailed'));
    }
  };

  const importSettings = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseSettingsJson(text);
      replaceSettings(parsed.settings);
      setSettingsError('');
      onToast(t('data.settingsImported'), 'success');
    } catch (reason) {
      setSettingsError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const importLanguage = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      const text = await file.text();
      const pack = parseLanguagePackJson(text, file.name);
      importLanguagePack(pack);
      setLanguageError('');
      onToast(t('language.imported', { label: pack.nativeLabel || pack.label }), 'success');
    } catch (reason) {
      setLanguageError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('settings.title')}
      closeLabel={t('common.close')}
      size="xl"
      className="settings-modal"
      footer={
        <div className="settings-footer">
          <span className="settings-footer-note">
            <Database24Regular /> {t('settings.storedLocally')}
          </span>
          <button type="button" className="fluent-button primary" onClick={onClose}>{t('common.done')}</button>
        </div>
      }
    >
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t('settings.title')} role="tablist">
          {TABS.map(({ id, icon: Icon, labelKey }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`settings-nav-item ${tab === id ? 'is-active' : ''}`.trim()}
              onClick={() => setTab(id)}
            >
              <Icon />
              <span>{t(labelKey)}</span>
            </button>
          ))}
        </nav>

        <div className="settings-content">
          {tab === 'appearance' ? (
            <>
              <SectionHeading title={t('appearance.title')} description={t('appearance.description')} />
              <div className="settings-card">
                <SettingRow title={t('appearance.theme')} description={t('appearance.themeHint')}>
                  <Segmented<ThemeChoice>
                    ariaLabel={t('appearance.theme')}
                    value={settings.theme}
                    onChange={(theme) => patch({ theme })}
                    options={[
                      { value: 'system', label: t('appearance.system'), icon: <Desktop24Regular /> },
                      { value: 'light', label: t('appearance.light'), icon: <WeatherSunny24Regular /> },
                      { value: 'dark', label: t('appearance.dark'), icon: <WeatherMoon24Regular /> },
                    ]}
                  />
                </SettingRow>
                <SettingRow title={t('appearance.glass')} description={t('appearance.glassHint')}>
                  <Switch
                    label={t('appearance.glass')}
                    checked={settings.liquidGlass}
                    onChange={(liquidGlass) => patch({ liquidGlass })}
                  />
                </SettingRow>
                <SettingRow title={t('appearance.reduceMotion')} description={t('appearance.reduceMotionHint')}>
                  <Switch
                    label={t('appearance.reduceMotion')}
                    checked={settings.reduceMotion}
                    onChange={(reduceMotion) => patch({ reduceMotion })}
                  />
                </SettingRow>
                <SettingRow title={t('appearance.hints')} description={t('appearance.hintsHint')}>
                  <Switch
                    label={t('appearance.hints')}
                    checked={settings.showCanvasHints}
                    onChange={(showCanvasHints) => patch({ showCanvasHints })}
                  />
                </SettingRow>
              </div>

              <SectionHeading title={t('appearance.pen')} description={t('appearance.penHint')} />
              <div className="settings-card">
                <SettingRow title={t('appearance.palm')} description={t('appearance.palmHint')}>
                  <Switch
                    label={t('appearance.palm')}
                    checked={settings.palmRejection}
                    onChange={(palmRejection) => patch({ palmRejection })}
                  />
                </SettingRow>
                <div className="setting-row is-stacked">
                  <div className="setting-copy">
                    <strong>{t('appearance.pressure')}</strong>
                    <span>{t('appearance.pressureHint')}</span>
                  </div>
                  <Slider
                    label={t('appearance.pressure')}
                    value={settings.pressureSensitivity}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(pressureSensitivity) => patch({ pressureSensitivity })}
                    display={`${Math.round(settings.pressureSensitivity * 100)}%`}
                  />
                </div>
              </div>
            </>
          ) : null}

          {tab === 'canvas' ? (
            <>
              <SectionHeading title={t('canvas.title')} description={t('canvas.description')} />
              <div className="settings-card canvas-settings-card">
                <BackgroundControls
                  value={settings.defaultBackground}
                  onChange={(defaultBackground) => patch({ defaultBackground })}
                  onReset={() => patch({ defaultBackground: defaultSettingsDocument().settings.defaultBackground })}
                />
              </div>
              <p className="settings-note">{t('canvas.noteHint')}</p>
            </>
          ) : null}

          {tab === 'language' ? (
            <>
              <SectionHeading title={t('language.title')} description={t('language.description')} />
              <div className="settings-card">
                <div className="language-list" role="radiogroup" aria-label={t('language.title')}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={preference === 'system'}
                    className={`language-row ${preference === 'system' ? 'is-active' : ''}`.trim()}
                    onClick={() => setLanguage('system')}
                  >
                    <span className="language-globe"><Desktop24Regular /></span>
                    <span className="language-copy">
                      <strong>{t('language.system')}</strong>
                      <small>{t('language.systemHint')}</small>
                    </span>
                    {preference === 'system' ? <CheckmarkCircle24Regular className="language-check" /> : null}
                  </button>
                  {languages.map((pack) => (
                    <button
                      key={pack.code}
                      type="button"
                      role="radio"
                      aria-checked={preference === pack.code}
                      className={`language-row ${preference === pack.code ? 'is-active' : ''}`.trim()}
                      onClick={() => setLanguage(pack.code)}
                    >
                      <span className="language-globe"><Globe24Regular /></span>
                      <span className="language-copy">
                        <strong>{pack.nativeLabel || pack.label}</strong>
                        <small>{pack.label} · {pack.code}</small>
                      </span>
                      {pack.source === 'imported' ? <span className="language-badge">{t('language.importedBadge')}</span> : null}
                      {preference === pack.code ? <CheckmarkCircle24Regular className="language-check" /> : null}
                    </button>
                  ))}
                </div>
                <div className="settings-inline-actions">
                  <button type="button" className="fluent-button" onClick={() => languageInputRef.current?.click()}>
                    <ArrowUpload24Regular />
                    {t('language.import')}
                  </button>
                </div>
                {languageError ? <p className="settings-error" role="alert">{languageError}</p> : null}
              </div>
              <SectionHeading title={t('language.fileTitle')} description={t('language.fileHint')} />
              <pre className="settings-code-sample">{`{
  "code": "pt-BR",
  "label": "Português",
  "nativeLabel": "Português (Brasil)",
  "translations": {
    "app.tagline": "Ideias, em tinta."
  }
}`}</pre>
            </>
          ) : null}

          {tab === 'data' ? (
            <>
              <SectionHeading title={t('data.title')} description={t('data.description')} />
              <div className="settings-card">
                <SettingRow title={t('data.settingsJson')} description={t('data.settingsJsonHint', { version: SETTINGS_JSON_VERSION })}>
                  <span className="settings-chip"><Code24Regular /> v{SETTINGS_JSON_VERSION}</span>
                </SettingRow>
                <div className="data-actions">
                  <button
                    type="button"
                    className="fluent-button"
                    onClick={() => {
                      const blob = new Blob([settingsJson], { type: 'application/json' });
                      downloadBlob(safeFilename('paligraph-settings', 'json'), blob);
                      onToast(t('data.downloaded'), 'success');
                    }}
                  >
                    <ArrowDownload24Regular />
                    {t('data.export')}
                  </button>
                  <button type="button" className="fluent-button" onClick={() => void copySettings()}>
                    {copied ? <CheckmarkCircle24Regular /> : <Copy24Regular />}
                    {copied ? t('data.copiedShort') : t('data.copy')}
                  </button>
                  <button type="button" className="fluent-button" onClick={() => settingsInputRef.current?.click()}>
                    <ArrowUpload24Regular />
                    {t('data.import')}
                  </button>
                  <button
                    type="button"
                    className={`fluent-button ${confirmReset ? 'danger' : ''}`.trim()}
                    onClick={() => {
                      if (!confirmReset) {
                        setConfirmReset(true);
                        window.setTimeout(() => setConfirmReset(false), 3500);
                        return;
                      }
                      resetSettings();
                      setConfirmReset(false);
                      onToast(t('data.resetDone'), 'success');
                    }}
                  >
                    {confirmReset ? t('data.resetConfirm') : t('data.reset')}
                  </button>
                </div>
                {settingsError ? <p className="settings-error" role="alert">{settingsError}</p> : null}
              </div>
              <SectionHeading title={t('data.preview')} description={t('data.previewHint')} />
              <pre className="settings-json-preview">{settingsJson}</pre>
              <p className="settings-note">{t('data.notesNotIncluded')}</p>
            </>
          ) : null}

          {tab === 'about' ? (
            <div className="about-settings">
              <img className="about-icon" src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" width={88} height={88} />
              <h3>Paligraph Canvas</h3>
              <p className="about-version">v{APP_VERSION} · Fluent Design · GNU GPL-3.0</p>
              <p className="about-copy">{t('about.description')}</p>
              <div className="about-links">
                <a className="fluent-button" href="https://github.com/whwdzg/Paligraph-Canvas" target="_blank" rel="noreferrer">
                  <Code24Regular />
                  GitHub
                </a>
                <a className="fluent-button" href="https://github.com/microsoft/fluentui-system-icons" target="_blank" rel="noreferrer">
                  <Color24Regular />
                  Fluent Icons
                </a>
              </div>
              <div className="about-shortcuts">
                <h4>{t('about.shortcuts')}</h4>
                <dl>
                  <div><dt>P / H / E / L</dt><dd>{t('about.shortcutsTools')}</dd></div>
                  <div><dt>Ctrl / ⌘ + Z</dt><dd>{t('about.shortcutsUndo')}</dd></div>
                  <div><dt>Ctrl / ⌘ + C / V</dt><dd>{t('about.shortcutsClipboard')}</dd></div>
                  <div><dt>Space + drag</dt><dd>{t('about.shortcutsPan')}</dd></div>
                  <div><dt>Ctrl / ⌘ + scroll</dt><dd>{t('about.shortcutsZoom')}</dd></div>
                  <div><dt>2-finger hold</dt><dd>{t('about.shortcutsTouch')}</dd></div>
                  <div><dt>0</dt><dd>{t('about.shortcutsReset')}</dd></div>
                </dl>
              </div>
              <p className="about-fineprint">
                {t('about.fineprint')} <span className="about-build">{__BUILD_TIME__.slice(0, 10)}</span>
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <input
        ref={settingsInputRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          void importSettings(event.currentTarget.files?.[0]);
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={languageInputRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          void importLanguage(event.currentTarget.files?.[0]);
          event.currentTarget.value = '';
        }}
      />
    </Modal>
  );
}
