import type { ReactNode } from 'react';
import { cn } from '../cn.js';

export function Card({
  title,
  actions,
  className,
  children,
}: {
  title?: string;
  /** Right-aligned header slot (buttons, filters). */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn('rounded-card border border-border bg-surface p-4 shadow-card', className)}
    >
      {title || actions ? (
        <header className="mb-3 flex items-center justify-between gap-3">
          {title ? <h3 className="font-ui text-body font-semibold text-ink">{title}</h3> : <span />}
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}
