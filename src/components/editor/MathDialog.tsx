import { useEffect, useMemo, useState } from 'react';
import { Checkmark24Regular, Copy24Regular, MathFormula24Regular, Sparkle24Regular } from '@fluentui/react-icons';
import { useI18n } from '../../i18n/I18nProvider';
import { mathStrokesBounds, recognizeMathStrokes } from '../../lib/math/recognizer';
import { evaluateArithmetic, normalizeMathInput, solveMathInput } from '../../lib/math/solver';
import { strokeToPath } from '../../lib/strokes';
import type { Stroke } from '../../lib/types';
import { Modal } from '../common/Modal';
import { Segmented } from '../common/Segmented';

interface MathDialogProps {
  strokes: Stroke[];
  onClose: () => void;
  onToast: (message: string) => void;
}

interface ArithmeticParts {
  a: string;
  operator: string;
  b: string;
  expression: string;
  value: number;
}

function parseSimpleArithmetic(input: string): ArithmeticParts | null {
  const normalized = normalizeMathInput(input);
  const match = normalized.match(/^(\d+(?:\.\d+)?)([+\-*/])(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const value = evaluateArithmetic(normalized);
  if (value === null) return null;
  const operator = match[2] === '*' ? '×' : match[2] === '/' ? '÷' : match[2];
  return { a: match[1], operator, b: match[3], expression: `${match[1]} ${operator} ${match[3]}`, value };
}

function StrokePreview({ strokes }: { strokes: Stroke[] }) {
  const { t } = useI18n();
  const bounds = mathStrokesBounds(strokes);
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const pad = Math.max(8, Math.min(width, height) * 0.16);
  return (
    <div className="math-preview-paper">
      <svg
        viewBox={`${bounds.minX - pad} ${bounds.minY - pad} ${width + pad * 2} ${height + pad * 2}`}
        role="img"
        aria-label={t('math.handwriting')}
      >
        {strokes.map((stroke) => (
          <path
            key={stroke.id}
            d={strokeToPath(stroke)}
            fill="none"
            stroke={stroke.color}
            strokeWidth={Math.max(1.6, stroke.size)}
            strokeOpacity={stroke.tool === 'highlighter' ? stroke.opacity : 1}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
      <span className="math-preview-badge">{t('math.handwriting')}</span>
    </div>
  );
}

function VerticalWorking({ parts }: { parts: ArithmeticParts }) {
  const { t } = useI18n();
  const whole = parts.value;
  const formatted = Number.isInteger(whole) ? String(whole) : String(Math.round(whole * 1e6) / 1e6);
  const width = Math.max(parts.a.length, parts.b.length, formatted.length) + 1;
  const pad = (text: string): string => text.padStart(width, ' ');
  return (
    <div className="vertical-work" aria-label={t('math.columnPreview')}>
      <div className="vertical-title">{t('math.columnPreview')}</div>
      <pre>
        <span>{pad(parts.a)}</span>
        <span>{`${parts.operator}${parts.b.padStart(width - 1, ' ')}`}</span>
        <span className="vertical-rule">{'─'.repeat(width)}</span>
        <span>{pad(formatted)}</span>
      </pre>
    </div>
  );
}

export function MathDialog({ strokes, onClose, onToast }: MathDialogProps) {
  const { t } = useI18n();
  const recognition = useMemo(() => recognizeMathStrokes(strokes), [strokes]);
  const [expression, setExpression] = useState(recognition.expression);
  const [mode, setMode] = useState<'equation' | 'column'>(recognition.layout === 'vertical' ? 'column' : 'equation');
  const [copied, setCopied] = useState(false);
  const solution = useMemo(() => solveMathInput(expression), [expression]);
  const arithmetic = useMemo(() => parseSimpleArithmetic(expression), [expression]);

  useEffect(() => {
    setExpression(recognition.expression);
    setMode(recognition.layout === 'vertical' ? 'column' : 'equation');
  }, [recognition]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyResult = async (): Promise<void> => {
    const text =
      mode === 'column' && arithmetic
        ? String(arithmetic.value)
        : solution.result ?? solution.steps[solution.steps.length - 1] ?? expression;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onToast(t('math.copied'));
    } catch {
      onToast(t('math.copyFailed'));
    }
  };

  const resultText =
    mode === 'column' && arithmetic
      ? Number.isInteger(arithmetic.value)
        ? String(arithmetic.value)
        : String(Math.round(arithmetic.value * 1e8) / 1e8)
      : solution.result ?? '';

  const confidenceLabel =
    recognition.confidence > 0.68
      ? t('math.confidenceHigh')
      : recognition.confidence > 0.4
        ? t('math.confidenceMedium')
        : t('math.confidenceLow');

  return (
    <Modal
      open
      onClose={onClose}
      title={t('math.title')}
      eyebrow={t('math.eyebrow')}
      closeLabel={t('common.close')}
      size="lg"
      className="math-modal"
      footer={
        <>
          <button type="button" className="fluent-button" onClick={() => void copyResult()}>
            {copied ? <Checkmark24Regular /> : <Copy24Regular />}
            {copied ? t('math.copiedShort') : t('math.copy')}
          </button>
          <button type="button" className="fluent-button primary" onClick={onClose}>{t('common.done')}</button>
        </>
      }
    >
      <div className="math-dialog">
        <section className="math-left">
          <StrokePreview strokes={strokes} />
          <div className="math-recognition-status">
            <span className={`confidence-dot confidence-${recognition.confidence > 0.68 ? 'high' : recognition.confidence > 0.4 ? 'medium' : 'low'}`} />
            <span>{confidenceLabel}</span>
            <span className="math-glyph-count">{t('math.characters', { count: recognition.glyphs.length })}</span>
          </div>
          {expression.trim() === recognition.expression.trim() ? (
            <div className="math-glyphs" aria-label={t('math.recognizedCharacters')}>
              {recognition.glyphs.map((glyph, index) => (
                <span
                  key={`${glyph.symbol}-${index}`}
                  className={`math-glyph ${glyph.confidence < 0.75 ? 'is-uncertain' : ''}`.trim()}
                  title={t('math.glyphConfidence', { count: Math.round(glyph.confidence * 100) })}
                >
                  {glyph.symbol}
                </span>
              ))}
            </div>
          ) : (
            <p className="math-edited-note">{t('math.edited')}</p>
          )}
          {recognition.layout === 'vertical' ? (
            <p className="math-layout-note">{t('math.verticalDetected')}</p>
          ) : null}
        </section>

        <section className="math-work">
          <label className="math-expression-label" htmlFor="math-expression">{t('math.expression')}</label>
          <div className="math-expression-field">
            <MathFormula24Regular aria-hidden="true" />
            <input
              id="math-expression"
              value={expression}
              onChange={(event) => setExpression(event.target.value)}
              placeholder={t('math.expressionPlaceholder')}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <p className="math-hint">{t('math.editHint')}</p>

          {arithmetic ? (
            <Segmented
              compact
              ariaLabel={t('math.mode')}
              value={mode}
              onChange={setMode}
              options={[
                { value: 'equation', label: t('math.equationMode') },
                { value: 'column', label: t('math.columnMode') },
              ]}
            />
          ) : null}

          <div className="math-answer" aria-live="polite">
            {mode === 'column' && arithmetic ? (
              <>
                <span className="math-answer-label">{t('math.answer')}</span>
                <strong>{resultText}</strong>
                <VerticalWorking parts={arithmetic} />
              </>
            ) : solution.kind === 'value' ? (
              <>
                <span className="math-answer-label">{t('math.answer')}</span>
                <strong>{solution.result}</strong>
              </>
            ) : solution.kind === 'equation' ? (
              <>
                <span className="math-answer-label">{t('math.answer')}</span>
                <strong>{solution.result}</strong>
                <ol className="math-steps">
                  {solution.steps.map((step, index) => <li key={`${step}-${index}`}>{step}</li>)}
                </ol>
              </>
            ) : solution.kind === 'identity' || solution.kind === 'none' ? (
              <div className="math-message">
                <Sparkle24Regular />
                <span>{solution.kind === 'identity' ? t('math.identity') : t('math.noSolution')}</span>
              </div>
            ) : solution.kind === 'true' || solution.kind === 'false' ? (
              <>
                <span className="math-answer-label">{t('math.answer')}</span>
                <strong>{solution.result}</strong>
                <div className={`math-message ${solution.kind === 'false' ? 'is-error' : ''}`.trim()}>
                  <Sparkle24Regular />
                  <span>{solution.kind === 'true' ? t('math.equationTrue') : t('math.equationFalse')}</span>
                </div>
              </>
            ) : solution.kind === 'empty' ? (
              <span className="math-placeholder">{t('math.enterExpression')}</span>
            ) : (
              <div className="math-message is-error">
                <span>{solution.error ?? t('math.unsupported')}</span>
              </div>
            )}
          </div>

          {recognition.warnings.length && expression.trim() === recognition.expression.trim() ? (
            <p className="math-warning">{t('math.lowConfidence')}</p>
          ) : null}
        </section>
      </div>
    </Modal>
  );
}
