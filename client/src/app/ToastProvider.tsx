import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ToastMessage } from '@shared';
import { Toaster } from '../components/Toaster';

interface ToastItem extends ToastMessage {
  id: number;
}

interface ToastContextValue {
  push: (toast: ToastMessage) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  push: () => undefined,
  success: () => undefined,
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (toast: ToastMessage) => {
      const id = idRef.current++;
      setToasts((current) => {
        const next = [...current, { ...toast, id }];
        return next.slice(-4);
      });
      window.setTimeout(() => dismiss(id), 4800);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      success: (message) => push({ kind: 'success', message }),
      error: (message) => push({ kind: 'error', message }),
      info: (message) => push({ kind: 'info', message }),
      warn: (message) => push({ kind: 'warn', message }),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}
