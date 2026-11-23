'use client';

import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

export type ToastTone = 'success' | 'info' | 'warning' | 'error';

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastContextValue {
  notify: (toast: Omit<ToastItem, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue>({
  notify: () => {},
});

const TONE_STYLES: Record<ToastTone, { box: string; icon: React.ComponentType<{ className?: string }>; iconColor: string }> = {
  success: {
    box: 'border-success/35 bg-white/95 text-ink shadow-lg shadow-success/10',
    icon: CheckCircle2,
    iconColor: 'text-success',
  },
  info: {
    box: 'border-brand/35 bg-white/95 text-ink shadow-lg shadow-brand/10',
    icon: Info,
    iconColor: 'text-brand',
  },
  warning: {
    box: 'border-warning/40 bg-white/95 text-ink shadow-lg shadow-warning/10',
    icon: AlertTriangle,
    iconColor: 'text-warning',
  },
  error: {
    box: 'border-danger/40 bg-white/95 text-ink shadow-lg shadow-danger/10',
    icon: XCircle,
    iconColor: 'text-danger',
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems(prev => prev.filter(item => item.id !== id));
  }, []);

  const notify = useCallback(
    (toast: Omit<ToastItem, 'id'>) => {
      const id = nextId.current++;
      setItems(prev => [...prev.slice(-3), { ...toast, id }]);
      window.setTimeout(() => {
        setItems(prev => prev.filter(item => item.id !== id));
      }, 3400);
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      {items.length > 0 && (
        <div
          aria-live="polite"
          aria-label="系统操作提示"
          className="pointer-events-none fixed top-4 right-4 z-[60] flex w-[320px] max-w-[calc(100vw-2rem)] flex-col gap-2"
        >
          {items.map(item => {
            const cfg = TONE_STYLES[item.tone];
            const Icon = cfg.icon;
            return (
              <div
                key={item.id}
                role="status"
                className={`animate-toast-in pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-3 backdrop-blur-md ${cfg.box}`}
              >
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${cfg.iconColor}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold leading-snug">{item.title}</div>
                  {item.description && (
                    <div className="mt-0.5 text-[11px] leading-relaxed text-ink-secondary">{item.description}</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(item.id)}
                  aria-label="关闭提示"
                  className="shrink-0 cursor-pointer rounded p-0.5 text-ink-muted transition hover:bg-subtle hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
