import { createRoot } from 'react-dom/client';
import App from './App';
import { I18nProvider } from './i18n/I18nProvider';
import './styles/index.css';

/**
 * Deliberately no StrictMode: development double-invocation would create a
 * second first-run note during the initial IndexedDB read, which is difficult
 * to distinguish from a genuine duplicate. Production behaviour is unchanged.
 */
const root = document.getElementById('root');
if (!root) throw new Error('Root element missing.');

createRoot(root).render(
  <I18nProvider>
    <App />
  </I18nProvider>,
);
