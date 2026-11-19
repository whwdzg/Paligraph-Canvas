import { Dismiss24Regular } from '@fluentui/react-icons';
import { useI18n } from '../../i18n/I18nProvider';
import { createShapePoints, isOpenShape } from '../../lib/shapes';
import type { ShapeKind } from '../../lib/types';

interface ShapePickerProps {
  onSelect: (kind: ShapeKind) => void;
  onClose: () => void;
}

const SHAPES: ShapeKind[] = [
  'line',
  'arrow',
  'rectangle',
  'square',
  'ellipse',
  'circle',
  'triangle',
  'equilateralTriangle',
  'diamond',
  'star',
  'pentagon',
  'hexagon',
  'check',
  'cross',
];

function ShapeGlyph({ kind }: { kind: ShapeKind }) {
  const points = createShapePoints(kind, { minX: 3, minY: 3, maxX: 37, maxY: 33 });
  const coordinate = (point: { x: number; y: number }): string => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  let path = '';
  if (kind === 'cross' && points.length >= 4) {
    path = `M${coordinate(points[0])} L${coordinate(points[1])} M${coordinate(points[2])} L${coordinate(points[3])}`;
  } else {
    path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${coordinate(point)}`).join(' ');
    if (!isOpenShape(kind)) path += ' Z';
  }
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ShapePicker({ onSelect, onClose }: ShapePickerProps) {
  const { t } = useI18n();
  return (
    <section className="shape-picker glass-surface" aria-label={t('shapes.title')}>
      <header className="options-header">
        <div>
          <span className="options-eyebrow">{t('shapes.eyebrow')}</span>
          <h3>{t('shapes.title')}</h3>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={t('common.close')}>
          <Dismiss24Regular />
        </button>
      </header>
      <div className="shape-picker-grid">
        {SHAPES.map((kind) => (
          <button
            key={kind}
            type="button"
            className="shape-picker-item"
            aria-label={t(`shape.${kind}`)}
            data-tooltip={t(`shape.${kind}`)}
            onClick={() => onSelect(kind)}
          >
            <ShapeGlyph kind={kind} />
            <span>{t(`shape.${kind}`)}</span>
          </button>
        ))}
      </div>
      <p className="shape-picker-hint">{t('shapes.hint')}</p>
    </section>
  );
}
