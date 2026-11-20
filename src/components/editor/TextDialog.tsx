import { useEffect, useState } from 'react';
import { TextBold24Regular, TextItalic24Regular } from '@fluentui/react-icons';
import { useI18n } from '../../i18n/I18nProvider';
import { DEFAULT_TEXT_STYLE, TEXT_FONTS, textFontStack } from '../../lib/textImage';
import type { NoteTextStyle } from '../../lib/types';
import { Modal } from '../common/Modal';

interface TextDialogProps {
  open: boolean;
  mode: 'insert' | 'edit';
  initial?: NoteTextStyle;
  onSave: (style: NoteTextStyle) => void | Promise<void>;
  onClose: () => void;
}

export function TextDialog({ open, mode, initial, onSave, onClose }: TextDialogProps) {
  const { t } = useI18n();
  const [style, setStyle] = useState<NoteTextStyle>(initial ?? DEFAULT_TEXT_STYLE);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setStyle(initial ?? DEFAULT_TEXT_STYLE);
  }, [initial, open]);

  const update = (patch: Partial<NoteTextStyle>): void => {
    setStyle((current) => ({ ...current, ...patch }));
  };

  const save = async (): Promise<void> => {
    if (!style.text.trim() || saving) return;
    setSaving(true);
    try {
      await onSave({ ...style, text: style.text.trim() });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'insert' ? t('text.insert') : t('text.editTitle')}
      eyebrow={t('text.eyebrow')}
      closeLabel={t('common.close')}
      size="md"
      className="text-modal"
      footer={
        <div className="text-dialog-actions">
          <button type="button" className="fluent-button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="fluent-button primary" onClick={() => void save()} disabled={!style.text.trim() || saving}>
            {mode === 'insert' ? t('text.insertAction') : t('text.save')}
          </button>
        </div>
      }
    >
      <div className="text-editor">
        <label className="text-editor-field">
          <span className="field-label">{t('text.content')}</span>
          <textarea
            className="text-input"
            value={style.text}
            rows={5}
            maxLength={2000}
            autoFocus
            placeholder={t('text.placeholder')}
            onChange={(event) => update({ text: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void save();
              }
            }}
          />
        </label>

        <div className="text-options-row">
          <label className="text-editor-field text-font-field">
            <span className="field-label">{t('text.font')}</span>
            <select className="text-font-select" value={style.fontId} onChange={(event) => update({ fontId: event.target.value })}>
              {TEXT_FONTS.map((font) => (
                <option key={font.id} value={font.id} style={{ fontFamily: font.stack }}>
                  {t(font.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-editor-field text-color-field">
            <span className="field-label">{t('text.color')}</span>
            <input type="color" value={style.color} onChange={(event) => update({ color: event.target.value })} />
          </label>
        </div>

        <div className="text-size-row">
          <label className="text-editor-field">
            <span className="field-label">{t('text.size')}</span>
            <input
              type="range"
              min={12}
              max={96}
              step={1}
              value={style.fontSize}
              onChange={(event) => update({ fontSize: Number(event.target.value) })}
            />
          </label>
          <span className="text-size-value">{style.fontSize} px</span>
          <div className="text-style-buttons" role="group" aria-label={t('text.style')}>
            <button
              type="button"
              className={`text-style-button ${style.bold ? 'is-active' : ''}`.trim()}
              aria-pressed={style.bold}
              aria-label={t('text.bold')}
              title={t('text.bold')}
              onClick={() => update({ bold: !style.bold })}
            >
              <TextBold24Regular />
            </button>
            <button
              type="button"
              className={`text-style-button ${style.italic ? 'is-active' : ''}`.trim()}
              aria-pressed={style.italic}
              aria-label={t('text.italic')}
              title={t('text.italic')}
              onClick={() => update({ italic: !style.italic })}
            >
              <TextItalic24Regular />
            </button>
          </div>
        </div>

        <div className="text-preview-wrap">
          <span className="field-label">{t('text.preview')}</span>
          <div
            className="text-preview"
            style={{
              fontFamily: textFontStack(style.fontId),
              fontSize: `${Math.min(style.fontSize, 44)}px`,
              fontWeight: style.bold ? 700 : 400,
              fontStyle: style.italic ? 'italic' : 'normal',
              color: style.color,
            }}
          >
            {style.text || t('text.previewPlaceholder')}
          </div>
        </div>
      </div>
    </Modal>
  );
}
