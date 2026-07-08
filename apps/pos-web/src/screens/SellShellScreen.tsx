import { Badge, Button, MoneyText } from '@retailos/ui';

/**
 * Placeholder behind the PIN lock — the real POS-03 Sell screen (per the
 * approved mockup) is Phase 1 scope. Phase 0 only proves the shell: density,
 * tokens, fullscreen app feel, sync pill placement.
 */
export function SellShellScreen({ onLock }: { onLock: () => void }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 flex-none items-center gap-4 border-b border-border bg-surface px-4">
        <div>
          <p className="text-pos-body font-semibold leading-tight text-ink">Bahay Kubo Grocers</p>
          <p className="text-caption text-ink-muted">Register 2 · Poblacion branch</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Badge tone="success">Synced · just now</Badge>
          <Button variant="secondary" size="pos" onClick={onLock}>
            Lock
          </Button>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md text-center">
          <p className="text-pos-total font-semibold text-ink">
            <MoneyText amount={0} currency="PHP" />
          </p>
          <h1 className="mt-2 text-h3 font-semibold text-ink">Register shell ready</h1>
          <p className="mt-2 text-pos-body text-ink-muted">
            Selling starts in Phase 1 — this shell proves tokens, POS density, and the PIN lock on
            web and desktop.
          </p>
        </div>
      </main>
    </div>
  );
}
