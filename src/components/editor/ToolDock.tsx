import {
  ArrowRedo24Regular,
  ArrowUndo24Regular,
  Eraser24Regular,
  Highlight24Regular,
  Lasso24Regular,
  Pen24Regular,
} from '@fluentui/react-icons';
import { useI18n } from '../../i18n/I18nProvider';
import type { InkTool } from '../../lib/types';

interface ToolDockProps {
  tool: InkTool;
  color: string;
  canUndo: boolean;
  canRedo: boolean;
  optionsOpen: boolean;
  onToolSelect: (tool: InkTool) => void;
  onColorSelect: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

const TOOL_ICONS = {
  pen: Pen24Regular,
  highlighter: Highlight24Regular,
  eraser: Eraser24Regular,
  lasso: Lasso24Regular,
} as const;

/** Apple Notes-like floating tool bar, translated into Fluent surfaces. */
export function ToolDock({
  tool,
  color,
  canUndo,
  canRedo,
  optionsOpen,
  onToolSelect,
  onColorSelect,
  onUndo,
  onRedo,
}: ToolDockProps) {
  const { t } = useI18n();
  const tools: InkTool[] = ['pen', 'highlighter', 'eraser', 'lasso'];

  return (
    <div className={`tool-dock glass-surface ${optionsOpen ? 'has-options' : ''}`.trim()} role="toolbar" aria-label={t('tools.label')}>
      <div className="tool-group tools-main">
        {tools.map((item) => {
          const Icon = TOOL_ICONS[item];
          const active = tool === item;
          return (
            <button
              key={item}
              type="button"
              className={`tool-button ${active ? 'is-active' : ''}`.trim()}
              aria-pressed={active}
              aria-label={t(`tools.${item}`)}
              data-tooltip={t(`tools.${item}`)}
              onClick={() => onToolSelect(item)}
            >
              <Icon />
              {active ? <span className="tool-active-dot" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>

      <span className="dock-divider" aria-hidden="true" />

      <button
        type="button"
        className={`color-well ${optionsOpen ? 'is-open' : ''}`.trim()}
        onClick={onColorSelect}
        aria-label={t('tools.color')}
        data-tooltip={t('tools.color')}
      >
        <span style={{ background: color }} />
      </button>

      <span className="dock-divider" aria-hidden="true" />

      <div className="tool-group history-tools">
        <button
          type="button"
          className="tool-button"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label={t('tools.undo')}
          data-tooltip={t('tools.undo')}
        >
          <ArrowUndo24Regular />
        </button>
        <button
          type="button"
          className="tool-button"
          onClick={onRedo}
          disabled={!canRedo}
          aria-label={t('tools.redo')}
          data-tooltip={t('tools.redo')}
        >
          <ArrowRedo24Regular />
        </button>
      </div>
    </div>
  );
}
