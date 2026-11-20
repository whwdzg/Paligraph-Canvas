import { useEffect, useState } from 'react';

interface WindowControlsOverlayLike extends EventTarget {
  visible: boolean;
  getTitlebarAreaRect: () => { x: number; y: number; width: number; height: number };
}

type NavigatorWithWindowControls = Navigator & {
  windowControlsOverlay?: WindowControlsOverlayLike;
};

/**
 * Tracks Chrome/Edge's Window Controls Overlay. In an installed PWA the app
 * owns the titlebar area; CSS uses the exposed geometry to keep header actions
 * clear of the native minimise/maximise/close buttons.
 */
export function useWindowControlsOverlay(): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const overlay = (navigator as NavigatorWithWindowControls).windowControlsOverlay;
    if (!overlay) return;

    const update = (): void => {
      try {
        const rect = overlay.getTitlebarAreaRect();
        const root = document.documentElement;
        root.style.setProperty('--wco-titlebar-height', `${Math.max(0, rect.height)}px`);
        root.style.setProperty('--wco-titlebar-left', `${Math.max(0, rect.x)}px`);
        root.style.setProperty(
          '--wco-controls-width',
          `${Math.max(0, window.innerWidth - rect.x - rect.width)}px`,
        );
        setVisible(Boolean(overlay.visible));
      } catch {
        setVisible(false);
      }
    };

    update();
    overlay.addEventListener('geometrychange', update);
    window.addEventListener('resize', update);
    return () => {
      overlay.removeEventListener('geometrychange', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  return visible;
}
