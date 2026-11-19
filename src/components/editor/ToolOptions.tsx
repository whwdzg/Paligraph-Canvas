import {
  Dismiss24Regular,
  DrawShape24Regular,
  Edit24Regular,
  Eraser24Regular,
  PaintBrush24Regular,
  Pen24Regular,
  Delete24Regular,
} from '@fluentui/react-icons';
import { useI18n } from '../../i18n/I18nProvider';
import { HIGHLIGHTER_COLORS, PEN_COLORS } from '../../config/palette';
import type { InkTool, PenVariant, Settings } from '../../lib/types';
import { Slider } from '../common/Slider';
import { Segmented } from '../common/Segmented';
import { StrokePreview } from './StrokePreview';

interface ToolOptionsProps {
  tool: Exclude<InkTool, 'lasso'>;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
  onClearAll: () => void;
}

const PEN_VARIANTS: Array<{ value: PenVariant; icon: typeof Pen24Regular }> = [
  { value: 'pen', icon: Pen24Regular },
  { value: 'pencil', icon: Edit24Regular },
  { value: 'crayon', icon: DrawShape24Regular },
  { value: 'brush', icon: PaintBrush24Regular },
];

function ColorSwatches({
  colors,
  value,
  onChange,
  customLabel,
}: {
  colors: readonly string[];
  value: string;
  onChange: (color: string) => void;
  customLabel: string;
}) {
  return (
    <div className="color-swatches">
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          className={`color-swatch ${value.toLowerCase() === color.toLowerCase() ? 'is-active' : ''}`.trim()}
          style={{ background: color }}
          onClick={() => onChange(color)}
          aria-label={color}
          aria-pressed={value.toLowerCase() === color.toLowerCase()}
        />
      ))}
      <label className="custom-color" aria-label={customLabel}>
        <input type="color" value={value} onChange={(event) => onChange(event.target.value)} />
        <span aria-hidden="true">+</span>
      </label>
    </div>
  );
}

/** Contextual Fluent options surface anchored above the tool dock. */
export function ToolOptions({ tool, settings, onChange, onClose, onClearAll }: ToolOptionsProps) {
  const { t } = useI18n();

  const title = tool === 'pen' ? t('tools.pen') : tool === 'highlighter' ? t('tools.highlighter') : t('tools.eraser');

  return (
    <section className="tool-options glass-surface" aria-label={`${title} ${t('tools.options')}`}>
      <header className="options-header">
        <div>
          <span className="options-eyebrow">{t('tools.options')}</span>
          <h3>{title}</h3>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={t('common.close')}>
          <Dismiss24Regular />
        </button>
      </header>

      {tool === 'pen' ? (
        <>
          <div className="option-section">
            <span className="field-label">{t('tools.penStyle')}</span>
            <div className="brush-grid" role="radiogroup" aria-label={t('tools.penStyle')}>
              {PEN_VARIANTS.map(({ value, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={settings.penVariant === value}
                  className={`brush-tile ${settings.penVariant === value ? 'is-selected' : ''}`.trim()}
                  onClick={() => onChange({ penVariant: value })}
                >
                  <span className="brush-tile-icon"><Icon /></span>
                  <span className="brush-tile-sample" aria-hidden="true">
                    <StrokePreview
                      variant={value}
                      color={settings.penColor}
                      size={Math.min(6, settings.penSize)}
                    />
                  </span>
                  <span>{t(`tools.penVariants.${value}`)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="option-section">
            <span className="field-label">{t('tools.color')}</span>
            <ColorSwatches
              colors={PEN_COLORS}
              value={settings.penColor}
              onChange={(penColor) => onChange({ penColor })}
              customLabel={t('tools.customColor')}
            />
          </div>
          <div className="option-row">
            <Slider
              label={t('tools.strokeWidth')}
              value={settings.penSize}
              min={0.75}
              max={28}
              step={0.25}
              onChange={(penSize) => onChange({ penSize })}
              display={`${settings.penSize.toFixed(1)} px`}
              accent={settings.penColor}
            />
            <div className="brush-preview" aria-hidden="true">
              <StrokePreview
                variant={settings.penVariant}
                color={settings.penColor}
                size={settings.penSize}
              />
            </div>
          </div>
        </>
      ) : null}

      {tool === 'highlighter' ? (
        <>
          <div className="option-section">
            <span className="field-label">{t('tools.highlightMode')}</span>
            <Segmented
              ariaLabel={t('tools.highlightMode')}
              value={settings.highlighterMode}
              onChange={(highlighterMode) => onChange({ highlighterMode })}
              options={[
                { value: 'free', label: t('tools.highlightFree') },
                { value: 'straight', label: t('tools.highlightStraight') },
              ]}
            />
            <p className="field-hint">
              {settings.highlighterMode === 'straight' ? t('tools.highlightStraightHint') : t('tools.highlightFreeHint')}
            </p>
          </div>
          <div className="option-section">
            <span className="field-label">{t('tools.color')}</span>
            <ColorSwatches
              colors={HIGHLIGHTER_COLORS}
              value={settings.highlighterColor}
              onChange={(highlighterColor) => onChange({ highlighterColor })}
              customLabel={t('tools.customColor')}
            />
          </div>
          <Slider
            label={t('tools.highlightWidth')}
            value={settings.highlighterSize}
            min={6}
            max={56}
            step={1}
            onChange={(highlighterSize) => onChange({ highlighterSize })}
            display={`${Math.round(settings.highlighterSize)} px`}
            accent={settings.highlighterColor}
          />
          <div className="highlight-preview" aria-hidden="true" style={{ background: settings.highlighterColor }}>
            <StrokePreview
              tool="highlighter"
              variant="pen"
              color={settings.highlighterColor}
              size={settings.highlighterSize}
              className="highlight-preview-ink"
            />
            <span>{t('tools.highlightPreview')}</span>
          </div>
        </>
      ) : null}

      {tool === 'eraser' ? (
        <>
          <div className="option-section">
            <span className="field-label">{t('tools.eraserMode')}</span>
            <div className="eraser-grid">
              <button
                type="button"
                className={`eraser-tile ${settings.eraserMode === 'stroke' ? 'is-selected' : ''}`.trim()}
                onClick={() => onChange({ eraserMode: 'stroke' })}
                aria-pressed={settings.eraserMode === 'stroke'}
              >
                <Edit24Regular />
                <span>
                  <strong>{t('tools.eraserStroke')}</strong>
                  <small>{t('tools.eraserStrokeHint')}</small>
                </span>
              </button>
              <button
                type="button"
                className={`eraser-tile ${settings.eraserMode === 'pixel' ? 'is-selected' : ''}`.trim()}
                onClick={() => onChange({ eraserMode: 'pixel' })}
                aria-pressed={settings.eraserMode === 'pixel'}
              >
                <Eraser24Regular />
                <span>
                  <strong>{t('tools.eraserPixel')}</strong>
                  <small>{t('tools.eraserPixelHint')}</small>
                </span>
              </button>
            </div>
          </div>
          <Slider
            label={t('tools.eraserSize')}
            value={settings.eraserSize}
            min={6}
            max={80}
            step={1}
            onChange={(eraserSize) => onChange({ eraserSize })}
            display={`${Math.round(settings.eraserSize)} px`}
            accent="var(--text-3)"
          />
          <button type="button" className="clear-canvas-button" onClick={onClearAll}>
            <Delete24Regular />
            <span>{t('tools.clearAll')}</span>
          </button>
        </>
      ) : null}
    </section>
  );
}
