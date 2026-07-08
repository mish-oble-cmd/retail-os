import { cn } from '../cn.js';

export interface NumberPadProps {
  /** Current value in integer minor units (or PIN digits as an integer). */
  value: number;
  onChange: (next: number) => void;
  /** Entry cap; further digits are ignored. Default ₱999,999.99 scale. */
  max?: number;
  /** Show the "00" key (money entry). Hide for PIN entry. */
  doubleZero?: boolean;
  className?: string;
}

/**
 * POS money/PIN entry pad (design-system.md primitive). Pure integer math —
 * digits shift left, ⌫ shifts right; the caller owns formatting via MoneyText.
 * Keys meet the 48px POS touch target at any density (it only ships on POS
 * screens, but the guarantee is unconditional).
 */
export function NumberPad({
  value,
  onChange,
  max = 99_999_999,
  doubleZero = true,
  className,
}: NumberPadProps) {
  function press(key: string) {
    let next = value;
    if (key === 'back') next = Math.floor(value / 10);
    else if (key === '00') next = value * 100;
    else next = value * 10 + Number(key);
    if (next > max) return;
    onChange(next);
  }

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', doubleZero ? '00' : '', '0', 'back'];

  return (
    <div role="group" aria-label="Number pad" className={cn('grid grid-cols-3 gap-2', className)}>
      {keys.map((key, i) =>
        key === '' ? (
          <span key={`blank-${i}`} aria-hidden />
        ) : (
          <button
            key={key}
            type="button"
            aria-label={key === 'back' ? 'Delete last digit' : key}
            onClick={() => press(key)}
            className={cn(
              'min-h-touch-pos min-w-touch-pos rounded-card border border-border bg-bg',
              'font-ui text-h3 font-medium text-ink',
              'transition-colors duration-[120ms] ease-out active:bg-border',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
            )}
          >
            {key === 'back' ? '⌫' : key}
          </button>
        ),
      )}
    </div>
  );
}
