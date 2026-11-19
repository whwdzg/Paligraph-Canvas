import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Dismiss24Regular } from '@fluentui/react-icons';
import { useI18n } from '../../i18n/I18nProvider';

interface ImagePreviewDialogProps {
  src: string;
  alt: string;
  onClose: () => void;
}

/** Lightbox for images embedded in imported Markdown notes. */
export function ImagePreviewDialog({ src, alt, onClose }: ImagePreviewDialogProps) {
  const { t } = useI18n();

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={alt || t('image.preview')} onPointerDown={onClose}>
      <figure onPointerDown={(event) => event.stopPropagation()}>
        <img src={src} alt={alt} />
        <figcaption>{alt || t('image.preview')}</figcaption>
      </figure>
      <button type="button" className="image-lightbox-close" onClick={onClose} aria-label={t('common.close')}>
        <Dismiss24Regular />
      </button>
    </div>,
    document.body,
  );
}
