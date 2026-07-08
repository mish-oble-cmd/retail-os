import { formatMoney, money } from '@retailos/domain';
import { cn } from '../cn.js';

export interface MoneyTextProps {
  /** Integer minor units — never a float (CLAUDE.md rule 5). */
  amount: number;
  currency: string;
  locale?: string;
  className?: string;
}

/**
 * The only sanctioned way to render money (design-system.md): formatting comes
 * from @retailos/domain, digits are tabular in the money font, negative
 * amounts (refunds) render in danger color.
 */
export function MoneyText({ amount, currency, locale = 'en-PH', className }: MoneyTextProps) {
  return (
    <span className={cn('font-money tabular-nums', amount < 0 && 'text-danger', className)}>
      {formatMoney(money(amount, currency), locale)}
    </span>
  );
}
