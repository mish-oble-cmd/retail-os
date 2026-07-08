import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { cn } from '../cn.js';
import { useDensity } from '../density.js';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, className, id, ...rest },
  ref,
) {
  const density = useDensity();
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1">
      {label ? (
        <label htmlFor={inputId} className="font-ui text-body-sm font-medium text-ink">
          {label}
        </label>
      ) : null}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          'w-full rounded border bg-surface font-ui text-ink placeholder:text-ink-muted',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
          'disabled:opacity-45',
          density === 'pos' ? 'min-h-touch-pos px-4 text-pos-body' : 'h-9 px-3 text-body-sm',
          error ? 'border-danger' : 'border-border',
          className,
        )}
        {...rest}
      />
      {error ? (
        <p id={`${inputId}-error`} className="font-ui text-body-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="font-ui text-caption text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
