import type { ToastMessage } from '@shared';

const ICONS: Record<ToastMessage['kind'], string> = {
  info: '›',
  success: '✓',
  warn: '!',
  error: '×',
};

export function Toaster({
  toasts,
  onDismiss,
}: {
  toasts: Array<ToastMessage & { id: number }>;
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="toaster" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.kind}`}
          role="status"
          onClick={() => onDismiss(toast.id)}
        >
          <span className="toast-icon" aria-hidden>
            {ICONS[toast.kind]}
          </span>
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
