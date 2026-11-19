import { useEffect, type RefObject } from 'react';

/** Closes a floating surface when a pointer lands outside all supplied nodes. */
export function useClickOutside(
  refs: ReadonlyArray<RefObject<HTMLElement | null>>,
  onOutside: () => void,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (!target) return;
      if (refs.some((ref) => ref.current?.contains(target))) return;
      onOutside();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [enabled, onOutside, refs]);
}
