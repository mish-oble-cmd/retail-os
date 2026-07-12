import {
  getOrderDetail,
  listRecentOrders,
  type OrderDetail,
  type OrderSummary,
  type SqlDriver,
  type StoreMeta,
} from '@retailos/sync';
import { Badge, Button, MoneyText } from '@retailos/ui';
import { useEffect, useMemo, useState } from 'react';

/**
 * POS-07 register orders. Reads register-local history (60-day retention) from
 * the device mirror, so search works identically offline. Refunded orders show
 * the amount inline; the refund entry point is danger-styled and separated.
 */

interface OrdersScreenProps {
  driver: SqlDriver;
  store: StoreMeta;
  onBack: () => void;
  onStartRefund: (orderId: string) => void;
}

export function OrdersScreen({ driver, store, onBack, onStartRefund }: OrdersScreenProps) {
  const [search, setSearch] = useState('');
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const list = listRecentOrders(driver, { search });
    setOrders(list);
    setSelectedId((prev) => prev ?? list[0]?.id ?? null);
  }, [driver, search]);

  const detail = useMemo(
    () => (selectedId ? getOrderDetail(driver, selectedId) : undefined),
    [driver, selectedId],
  );

  return (
    <div className="flex h-screen flex-col bg-bg">
      <header className="flex h-14 flex-none items-center gap-4 border-b border-border bg-surface px-4">
        <button onClick={onBack} className="flex items-center gap-1 text-body text-ink-muted hover:text-ink">
          ‹ Back to sell
        </button>
        <p className="text-pos-body font-semibold text-ink">Orders</p>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* List */}
        <div className="flex w-[380px] flex-none flex-col border-r border-border bg-surface">
          <div className="p-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Order # or date…"
              className="min-h-touch-pos w-full rounded border border-border bg-surface px-3 text-body text-ink outline-none focus:border-primary"
            />
          </div>
          <div className="flex-1 overflow-auto">
            {orders.length === 0 && <p className="p-4 text-body-sm text-ink-muted">No orders yet.</p>}
            {orders.map((o) => (
              <button
                key={o.id}
                onClick={() => setSelectedId(o.id)}
                className={'flex w-full items-center gap-2 border-b border-border px-4 py-3 text-left ' + (selectedId === o.id ? 'bg-bg' : '')}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-money font-medium text-ink">{o.number}</p>
                  <p className="text-caption text-ink-muted">{new Date(o.clientCreatedAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                </div>
                {o.state !== 'completed' && (
                  <Badge tone={o.state === 'refunded' ? 'danger' : 'warning'}>
                    {o.state === 'refunded' ? 'Refunded' : o.state === 'partially_refunded' ? 'Partial refund' : o.state}
                  </Badge>
                )}
                <MoneyText amount={o.totalAmount} currency={store.currency} />
              </button>
            ))}
          </div>
        </div>

        {/* Detail */}
        <div className="min-w-0 flex-1 overflow-auto p-6">
          {detail ? <OrderDetailPanel detail={detail} store={store} onStartRefund={onStartRefund} /> : (
            <p className="text-body-sm text-ink-muted">Select an order.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function OrderDetailPanel({ detail, store, onStartRefund }: { detail: OrderDetail; store: StoreMeta; onStartRefund: (id: string) => void }) {
  const refundedTotal = detail.refunds.reduce((sum, r) => sum + r.totalAmount, 0);
  const anyRefundable = detail.lines.some((l) => l.qty - l.refundedQty > 0);
  return (
    <div className="mx-auto max-w-lg">
      <div className="flex items-center gap-3">
        <h1 className="font-money text-h2 font-semibold text-ink">{detail.number}</h1>
        {detail.state !== 'completed' && (
          <Badge tone={detail.state === 'refunded' ? 'danger' : 'warning'}>
            {detail.state === 'refunded' ? `Refunded ${fmt(refundedTotal, store.currency)}` : 'Partial refund'}
          </Badge>
        )}
      </div>
      <p className="mt-1 text-body-sm text-ink-muted">{new Date(detail.clientCreatedAt).toLocaleString('en-PH')}</p>

      <div className="mt-4 rounded-card border border-border bg-surface">
        {detail.lines.map((line) => (
          <div key={line.id} className="flex items-center gap-2 border-b border-border px-4 py-3 last:border-b-0">
            <div className="min-w-0 flex-1">
              <p className="text-pos-body text-ink">{line.name} <span className="text-ink-muted">×{line.qty}</span></p>
              {line.refundedQty > 0 && <p className="text-caption text-danger">Refunded {line.refundedQty} of {line.qty}</p>}
            </div>
            <MoneyText amount={line.totalAmount} currency={store.currency} />
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-card border border-border bg-surface px-4 py-3">
        <Row label="Total" value={<MoneyText amount={detail.totalAmount} currency={store.currency} />} bold />
        {detail.payments.map((p) => (
          <Row key={p.id} label={p.tenderType === 'cash' ? 'Cash' : 'Card'} value={<MoneyText amount={p.amount + p.changeAmount} currency={store.currency} />} />
        ))}
        <Row label="VAT" value={<MoneyText amount={detail.taxAmount} currency={store.currency} />} />
      </div>

      <div className="mt-4 flex justify-end">
        <Button variant="danger" onClick={() => onStartRefund(detail.id)} disabled={!anyRefundable}>
          Refund…
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: React.ReactNode; bold?: boolean }) {
  return (
    <div className={'flex justify-between py-0.5 ' + (bold ? 'font-semibold text-ink' : 'text-ink-muted')}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

const fmt = (amount: number, currency: string) => (amount / 100).toLocaleString('en-PH', { style: 'currency', currency });
