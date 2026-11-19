import { useCallback, useRef, useState } from 'react';

export type ToastTone = 'neutral' | 'success' | 'error';

export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

/**
 * Tiny toast queue. Toasts are intentionally ephemeral and never persisted;
 * long-running errors remain visible in the importing/exporting UI itself.
 */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismissToast = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback(
    (message: string, tone: ToastTone = 'neutral') => {
      if (!message) return;
      const id = nextId.current++;
      setToasts((current) => [...current.slice(-2), { id, message, tone }]);
      const timer = window.setTimeout(() => dismissToast(id), tone === 'error' ? 5200 : 3000);
      timers.current.set(id, timer);
    },
    [dismissToast],
  );

  return { toasts, pushToast, dismissToast };
}
