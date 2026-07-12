import { Button, Modal, MoneyText } from '@retailos/ui';
import type { ParkedCartSummary } from '@retailos/sync';

/**
 * POS-06 parked carts. Named holds with age + attribution; Retrieve is the
 * primary per-row action, Discard is danger-styled and separated. Retrieving
 * while the current cart has items re-parks the current one first (collision
 * rule stated up front).
 */

interface ParkedCartsSheetProps {
  parked: ParkedCartSummary[];
  currency: string;
  currentItemCount: number;
  staffNameById: Map<string, string>;
  onRetrieve: (id: string) => void;
  onDiscard: (id: string) => void;
  onClose: () => void;
}

function ago(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

export function ParkedCartsSheet({
  parked,
  currency,
  currentItemCount,
  staffNameById,
  onRetrieve,
  onDiscard,
  onClose,
}: ParkedCartsSheetProps) {
  return (
    <Modal open title="Parked carts" onClose={onClose} className="max-w-xl">
      {currentItemCount > 0 && parked.length > 0 && (
        <p className="mb-3 rounded border border-warning/40 bg-[#FDF3E3] px-3 py-2 text-body-sm text-ink">
          You have {currentItemCount} item{currentItemCount === 1 ? '' : 's'} in the current cart. Retrieving a
          parked cart parks the current one first.
        </p>
      )}

      {parked.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-pos-body font-medium text-ink">No parked carts</p>
          <p className="max-w-xs text-body-sm text-ink-muted">
            Park an in-progress sale to serve another customer, then retrieve it here — it survives restarts.
          </p>
          <Button variant="secondary" onClick={onClose}>Back to selling</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {parked.map((cart) => (
            <div key={cart.id} className="flex items-center gap-3 rounded-card border border-border p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-pos-body font-medium text-ink">{cart.name}</p>
                <p className="text-body-sm text-ink-muted">
                  {cart.itemCount} item{cart.itemCount === 1 ? '' : 's'} · parked {ago(cart.updatedAt)}
                  {cart.staffId ? ` by ${staffNameById.get(cart.staffId) ?? '—'}` : ''}
                </p>
              </div>
              <span className="font-medium text-ink"><MoneyText amount={cart.totalAmount} currency={currency} /></span>
              <Button onClick={() => onRetrieve(cart.id)}>Retrieve</Button>
              <button
                onClick={() => onDiscard(cart.id)}
                aria-label={`Discard ${cart.name}`}
                className="flex h-12 w-12 items-center justify-center rounded border border-border text-ink-muted hover:border-danger hover:text-danger"
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
