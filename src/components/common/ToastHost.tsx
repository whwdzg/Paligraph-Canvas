import { CheckmarkCircle24Filled, Dismiss24Regular, ErrorCircle24Filled, Info24Filled } from '@fluentui/react-icons';
import type { ToastItem } from '../../hooks/useToasts';

interface ToastHostProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
  dismissLabel: string;
}

export function ToastHost({ toasts, onDismiss, dismissLabel }: ToastHostProps) {
  return (
    <div className="toast-host" role="region" aria-live="polite" aria-label="Notifications">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.tone}`} role="status">
          <span className="toast-icon" aria-hidden="true">
            {toast.tone === 'success' ? (
              <CheckmarkCircle24Filled />
            ) : toast.tone === 'error' ? (
              <ErrorCircle24Filled />
            ) : (
              <Info24Filled />
            )}
          </span>
          <span>{toast.message}</span>
          <button type="button" className="toast-close" onClick={() => onDismiss(toast.id)} aria-label={dismissLabel}>
            <Dismiss24Regular />
          </button>
        </div>
      ))}
    </div>
  );
}
