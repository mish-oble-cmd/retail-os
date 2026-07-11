const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'] as const;

export function PinPad({
  onDigit,
  onBackspace,
  onClear,
  disabled,
}: {
  onDigit: (d: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid w-64 grid-cols-3 gap-2">
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          disabled={disabled}
          onClick={() => (key === 'clear' ? onClear() : key === 'back' ? onBackspace() : onDigit(key))}
          className="rounded-card border border-border bg-surface py-4 text-h3 text-ink shadow-card active:translate-y-px disabled:opacity-40"
        >
          {key === 'clear' ? 'C' : key === 'back' ? '⌫' : key}
        </button>
      ))}
    </div>
  );
}
