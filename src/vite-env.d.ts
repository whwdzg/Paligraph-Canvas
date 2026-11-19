/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

interface Window {
  /** Started by the inline bootstrap in index.html before React loads. */
  __PALIGRAPH_LOCALE?: Promise<Record<string, string>>;
  __PALIGRAPH_LOCALE_CODE?: string;
}
