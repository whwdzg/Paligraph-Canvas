import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export interface PwaInstallController {
  canInstall: boolean;
  installed: boolean;
  isIos: boolean;
  isStandalone: boolean;
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

function standaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches;
}

function iosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * Captures Chrome/Edge's install prompt and exposes a single, reusable install
 * action. Safari never fires `beforeinstallprompt`; the caller can show manual
 * Add-to-Home-Screen instructions instead.
 */
export function usePwaInstall(): PwaInstallController {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(standaloneMode);
  const [isIos] = useState(iosDevice);

  useEffect(() => {
    const onBeforeInstall = (event: Event): void => {
      const prompt = event as BeforeInstallPromptEvent;
      prompt.preventDefault();
      setDeferredPrompt(prompt);
    };
    const onInstalled = (): void => {
      setInstalled(true);
      setDeferredPrompt(null);
    };
    const media = window.matchMedia('(display-mode: standalone)');
    const onDisplayMode = (): void => setInstalled(standaloneMode());

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    media.addEventListener?.('change', onDisplayMode);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      media.removeEventListener?.('change', onDisplayMode);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!deferredPrompt) return 'unavailable';
    const prompt = deferredPrompt;
    setDeferredPrompt(null);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') setInstalled(true);
      return choice.outcome;
    } catch {
      return 'unavailable';
    }
  }, [deferredPrompt]);

  return {
    canInstall: Boolean(deferredPrompt) && !installed,
    installed,
    isIos,
    isStandalone: installed,
    promptInstall,
  };
}
