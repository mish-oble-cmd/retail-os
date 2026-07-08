import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../cn.js';
import { useDensity } from '../density.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'pos';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Defaults from density: admin → md, pos → pos */
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-hover',
  secondary: 'bg-surface text-ink border border-border hover:bg-bg',
  ghost: 'bg-transparent text-ink hover:bg-bg',
  danger: 'bg-danger text-white hover:opacity-90',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-body-sm',
  md: 'h-9 px-4 text-body-sm',
  pos: 'min-h-touch-pos px-5 text-pos-body',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size, className, type, ...rest },
  ref,
) {
  const density = useDensity();
  const resolvedSize = size ?? (density === 'pos' ? 'pos' : 'md');
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded font-ui font-medium',
        'transition-colors duration-[120ms] ease-out',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        'disabled:pointer-events-none disabled:opacity-45',
        variantClasses[variant],
        sizeClasses[resolvedSize],
        className,
      )}
      {...rest}
    />
  );
});
