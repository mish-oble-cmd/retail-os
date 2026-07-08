import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../cn.js';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Footer slot — actions. Destructive actions must not sit next to primary. */
  footer?: ReactNode;
  className?: string;
}

/**
 * Basic modal (Phase 0): overlay + dialog semantics + Escape-to-close.
 * Full focus trapping arrives with the first real form usage in Phase 1.
 */
export function Modal({ open, onClose, title, children, footer, className }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-6"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          'w-full max-w-lg rounded-card bg-surface shadow-overlay outline-none',
          className,
        )}
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-ui text-h3 font-semibold text-ink">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded text-ink-muted hover:bg-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            ✕
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer ? (
          <footer className="flex justify-end gap-3 border-t border-border px-5 py-4">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
