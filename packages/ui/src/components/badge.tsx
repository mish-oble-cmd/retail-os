import type { ReactNode } from 'react';
import { cn } from '../cn.js';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-bg text-ink-muted border-border',
  success: 'bg-success/10 text-success border-success/30',
  warning: 'bg-warning/10 text-warning border-warning/30',
  danger: 'bg-danger/10 text-danger border-danger/30',
  accent: 'bg-accent/10 text-accent border-accent/30',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5',
        'font-ui text-caption font-medium',
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
