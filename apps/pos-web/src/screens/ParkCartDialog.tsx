import { Button, Modal, MoneyText } from '@retailos/ui';
import { useState } from 'react';

/**
 * POS-06 park prompt. Names the hold so it is findable later; defaults to a
 * timestamped "Unnamed —" label so parking is never blocked on typing.
 */
interface ParkCartDialogProps {
  itemCount: number;
  total: number;
  currency: string;
  parkedCount: number;
  onPark: (name: string) => void;
  onViewParked: () => void;
  onClose: () => void;
}

function defaultName(): string {
  const now = new Date();
  return `Unnamed — ${now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}`;
}

export function ParkCartDialog({
  itemCount,
  total,
  currency,
  parkedCount,
  onPark,
  onViewParked,
  onClose,
}: ParkCartDialogProps) {
  const [name, setName] = useState('');
  const label = name.trim() || defaultName();
  return (
    <Modal
      open
      title="Park cart"
      onClose={onClose}
      footer={
        <>
          {parkedCount > 0 && (
            <Button variant="ghost" onClick={onViewParked}>View parked ({parkedCount})</Button>
          )}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onPark(label)}>Park cart</Button>
        </>
      }
    >
      <p className="mb-3 text-body-sm text-ink-muted">
        Holding {itemCount} item{itemCount === 1 ? '' : 's'} · <MoneyText amount={total} currency={currency} />
      </p>
      <label className="text-body-sm text-ink-muted">Name (optional)</label>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={defaultName()}
        className="mt-1 w-full rounded border border-border bg-surface px-3 py-2 text-body text-ink outline-none focus:border-primary"
      />
    </Modal>
  );
}
