import type { ReactNode } from 'react';
import { cn } from '../cn.js';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

const toneClasses: Record<ToastTone, string> = {
  info: 'border-border',
  success: 'border-success/40',
  warning: 'border-warning/40',
  danger: 'border-danger/40',
};

const toneDot: Record<ToastTone, string> = {
  info: 'bg-ink-muted',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

/**
 * Presentational toast (Phase 0). A queueing ToastProvider comes with the
 * first async flows in Phase 1 — screens today render these directly.
 */
export function Toast({
  tone = 'info',
  onDismiss,
  className,
  children,
}: {
  tone?: ToastTone;
  onDismiss?: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      className={cn(
        'flex w-full max-w-sm items-center gap-3 rounded-card border bg-surface px-4 py-3 shadow-overlay',
        toneClasses[tone],
        className,
      )}
    >
      <span aria-hidden className={cn('h-2.5 w-2.5 flex-none rounded-full', toneDot[tone])} />
      <div className="flex-1 font-ui text-body-sm text-ink">{children}</div>
      {onDismiss ? (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="flex h-8 w-8 flex-none items-center justify-center rounded text-ink-muted hover:bg-bg"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}
