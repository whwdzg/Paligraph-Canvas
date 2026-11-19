import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowClockwise24Regular,
  ArrowDownload24Regular,
  ArrowUpload24Regular,
  CheckmarkCircle24Regular,
  Code24Regular,
  Color24Regular,
  Copy24Regular,
  Database24Regular,
  Desktop24Regular,
  Globe24Regular,
  HardDrive24Regular,
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
import { formatBytes, formatPercent } from '../../lib/format';
import { measureStorageUsage, storagePercent, type StorageUsage } from '../../lib/storageUsage';
import { useSettingsStore } from '../../state/settings';
import type { Note, ThemeChoice } from '../../lib/types';
import { Modal } from '../common/Modal';
import { Switch } from '../common/Switch';
import { Segmented } from '../common/Segmented';
import { Slider } from '../common/Slider';
import { BackgroundControls } from '../editor/BackgroundControls';

type SettingsTab = 'appearance' | 'canvas' | 'language' | 'data' | 'about';

interface SettingsDialogProps {
  open: boolean;
  notes: Note[];
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

export function SettingsDialog({ open, notes, onClose, onToast }: SettingsDialogProps) {
  const { t, languages, preference, setLanguage, importLanguagePack } = useI18n();
  const settings = useSettingsStore();
  const { patch, replaceSettings, resetSettings } = settings;
  const [tab, setTab] = useState<SettingsTab>('appearance');
  const [settingsError, setSettingsError] = useState('');
  const [languageError, setLanguageError] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
  const [storageError, setStorageError] = useState('');
  const [storageLoading, setStorageLoading] = useState(false);
  const settingsInputRef = useRef<HTMLInputElement>(null);
  const languageInputRef = useRef<HTMLInputElement>(null);

  const settingsJson = useMemo(() => serializeSettings(settings), [settings]);

  const refreshStorage = useCallback(async (): Promise<void> => {
    setStorageLoading(true);
    setStorageError('');
    try {
      setStorageUsage(await measureStorageUsage(notes));
    } catch (reason) {
      setStorageError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStorageLoading(false);
    }
  }, [notes]);

  useEffect(() => {
    if (open && tab === 'data') void refreshStorage();
  }, [open, refreshStorage, tab]);

  const storageUsed = storageUsage ? storageUsage.browserUsage ?? storageUsage.totalBytes : 0;
  const storageQuota = storageUsage?.browserQuota ?? 0;
  const storageRatio = storageUsage ? storagePercent(storageUsage) : 0;
  const storagePercentLabel = storageRatio > 0 && storageRatio < 0.01 ? '<1%' : formatPercent(storageRatio);
  const storageAriaValue = storageRatio > 0 ? Math.max(1, Math.round(storageRatio * 100)) : 0;

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
                <SettingRow title={t('appearance.shape')} description={t('appearance.shapeHint')}>
                  <Switch
                    label={t('appearance.shape')}
                    checked={settings.shapeRecognition}
                    onChange={(shapeRecognition) => patch({ shapeRecognition })}
                  />
                </SettingRow>
                <SettingRow title={t('appearance.math')} description={t('appearance.mathHint')}>
                  <Switch
                    label={t('appearance.math')}
                    checked={settings.mathRecognition}
                    onChange={(mathRecognition) => patch({ mathRecognition })}
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
              <SectionHeading title={t('storage.title')} description={t('storage.description')} />
              <div className="settings-card storage-card">
                <div className="storage-summary">
                  <div className="storage-summary-head">
                    <span className="storage-icon"><HardDrive24Regular /></span>
                    <div className="storage-summary-copy">
                      <span>{t('storage.browser')}</span>
                      <strong>{storageUsage ? formatBytes(storageUsed) : '—'}</strong>
                      <small>
                        {storageUsage
                          ? t('storage.notesMeta', {
                              notes: storageUsage.noteCount,
                              images: storageUsage.imageCount,
                            })
                          : t('storage.loading')}
                      </small>
                    </div>
                    <button
                      type="button"
                      className={`icon-button storage-refresh ${storageLoading ? 'is-spinning' : ''}`.trim()}
                      onClick={() => void refreshStorage()}
                      disabled={storageLoading}
                      aria-label={t('storage.refresh')}
                      title={t('storage.refresh')}
                    >
                      <ArrowClockwise24Regular />
                    </button>
                  </div>
                  <div
                    className="storage-meter"
                    role="progressbar"
                    aria-label={t('storage.browser')}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={storageAriaValue}
                  >
                    <span style={{ width: `${storageRatio > 0 ? Math.max(2, storageRatio * 100) : 0}%` }} />
                  </div>
                  <div className="storage-meter-meta">
                    <span>
                      {storageQuota
                        ? t('storage.ofQuota', { percent: storagePercentLabel, quota: formatBytes(storageQuota) })
                        : t('storage.quotaUnknown')}
                    </span>
                    <span>
                      {storageUsage?.persisted === true
                        ? t('storage.persistent')
                        : storageUsage?.persisted === false
                          ? t('storage.bestEffort')
                          : ''}
                    </span>
                  </div>
                </div>
                <div className="storage-breakdown">
                  <div className="storage-row">
                    <span>{t('storage.notesTotal')}</span>
                    <strong>{storageUsage ? formatBytes(storageUsage.notesBytes) : '—'}</strong>
                  </div>
                  <div className="storage-row">
                    <span>{t('storage.strokes')}</span>
                    <strong>{storageUsage ? formatBytes(storageUsage.strokeBytes) : '—'}</strong>
                  </div>
                  <div className="storage-row">
                    <span>{t('storage.images')}</span>
                    <strong>{storageUsage ? formatBytes(storageUsage.imageBytes) : '—'}</strong>
                  </div>
                  <div className="storage-row">
                    <span>{t('storage.markdown')}</span>
                    <strong>{storageUsage ? formatBytes(storageUsage.markdownBytes) : '—'}</strong>
                  </div>
                  <div className="storage-row">
                    <span>{t('storage.attachments')}</span>
                    <strong>{storageUsage ? formatBytes(storageUsage.attachmentBytes) : '—'}</strong>
                  </div>
                  <div className="storage-row">
                    <span>{t('storage.thumbnails')}</span>
                    <strong>{storageUsage ? formatBytes(storageUsage.thumbnailBytes) : '—'}</strong>
                  </div>
                  <div className="storage-row">
                    <span>{t('storage.settings')}</span>
                    <strong>{storageUsage ? formatBytes(storageUsage.settingsBytes) : '—'}</strong>
                  </div>
                  <div className="storage-row">
                    <span>{t('storage.languages')}</span>
                    <strong>{storageUsage ? formatBytes(storageUsage.languageBytes) : '—'}</strong>
                  </div>
                </div>
              </div>
              {storageError ? <p className="settings-error" role="alert">{storageError}</p> : null}
              <p className="settings-note">{t('storage.estimateNote')}</p>

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
                  <div><dt>Long-press ink</dt><dd>{t('about.shortcutsMath')}</dd></div>
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
