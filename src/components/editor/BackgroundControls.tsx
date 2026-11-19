import { ArrowReset24Regular } from '@fluentui/react-icons';
import { useI18n } from '../../i18n/I18nProvider';
import { PAPER_TINTS } from '../../config/palette';
import type { BackgroundSettings, PaperPattern } from '../../lib/types';
import { Segmented } from '../common/Segmented';
import { Slider } from '../common/Slider';

interface BackgroundControlsProps {
  value: BackgroundSettings;
  onChange: (background: BackgroundSettings) => void;
  onReset?: () => void;
}

const PATTERNS: Array<{ value: PaperPattern; labelKey: string }> = [
  { value: 'blank', labelKey: 'background.blank' },
  { value: 'grid', labelKey: 'background.grid' },
  { value: 'dots', labelKey: 'background.dots' },
  { value: 'ruled', labelKey: 'background.ruled' },
  { value: 'axes', labelKey: 'background.axes' },
];

export function BackgroundControls({ value, onChange, onReset }: BackgroundControlsProps) {
  const { t } = useI18n();
  const update = (patch: Partial<BackgroundSettings>): void => onChange({ ...value, ...patch });

  return (
    <div className="background-controls">
      <span className="field-label">{t('background.pattern')}</span>
      <div className="pattern-grid" role="radiogroup" aria-label={t('background.pattern')}>
        {PATTERNS.map((pattern) => (
          <button
            key={pattern.value}
            type="button"
            role="radio"
            aria-checked={value.pattern === pattern.value}
            className={`pattern-tile pattern-${pattern.value} ${value.pattern === pattern.value ? 'is-selected' : ''}`.trim()}
            onClick={() => update({ pattern: pattern.value })}
          >
            <span className="pattern-swatch" aria-hidden="true" data-line-style={value.lineStyle} />
            <span>{t(pattern.labelKey)}</span>
          </button>
        ))}
      </div>
      {value.pattern === 'axes' ? <p className="background-hint">{t('background.axesHint')}</p> : null}

      <div className="option-section">
        <span className="field-label">{t('background.lineStyle')}</span>
        <Segmented
          compact
          ariaLabel={t('background.lineStyle')}
          value={value.lineStyle}
          onChange={(lineStyle) => update({ lineStyle })}
          options={[
            { value: 'solid', label: t('background.solid') },
            { value: 'dashed', label: t('background.dashed') },
          ]}
        />
      </div>

      <div className="option-row two-sliders">
        <Slider
          label={t('background.spacing')}
          value={value.spacing}
          min={12}
          max={96}
          step={2}
          onChange={(spacing) => update({ spacing })}
          display={`${value.spacing} px`}
        />
        <Slider
          label={t('background.opacity')}
          value={value.opacity}
          min={0}
          max={0.6}
          step={0.01}
          onChange={(opacity) => update({ opacity })}
          display={`${Math.round(value.opacity * 100)}%`}
        />
      </div>

      <div className="option-section">
        <span className="field-label">{t('background.tint')}</span>
        <div className="tint-row">
          {PAPER_TINTS.map((tint) => (
            <button
              key={tint.label}
              type="button"
              className={`tint-swatch tint-${tint.label} ${value.color === tint.value ? 'is-active' : ''}`.trim()}
              style={tint.value ? { background: tint.value } : undefined}
              aria-label={t(`background.tints.${tint.label}`)}
              aria-pressed={value.color === tint.value}
              onClick={() => update({ color: tint.value })}
            >
              {tint.value ? null : <span className="tint-auto-mark" aria-hidden="true">A</span>}
            </button>
          ))}
          <label className="custom-tint" aria-label={t('background.customTint')}>
            <input
              type="color"
              value={value.color || '#64748b'}
              onChange={(event) => update({ color: event.target.value })}
            />
            <span aria-hidden="true">+</span>
          </label>
        </div>
      </div>

      {onReset ? (
        <button type="button" className="text-button reset-background" onClick={onReset}>
          <ArrowReset24Regular />
          {t('background.reset')}
        </button>
      ) : null}
    </div>
  );
}
