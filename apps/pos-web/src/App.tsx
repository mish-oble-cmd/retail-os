import { getStoreMeta, listParkedCarts, pendingCount, type BrowserDriverHandle, type SqlDriver, type StoreMeta } from '@retailos/sync';
import type { Discount } from '@retailos/domain';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCart } from './lib/cart';
import { listTaxCategories, openDevice, type TaxCategoryOption } from './lib/device';
import { deviceStaffDirectory, type StaffDirectory } from './lib/staff-directory';
import { useIdleLock } from './lib/use-idle-lock';
import type { LocalSaleInput } from '@retailos/sync';
import { CustomSaleSheet } from './screens/CustomSaleSheet';
import { DiscountSheet } from './screens/DiscountSheet';
import { PaymentScreen } from './screens/PaymentScreen';
import { PinLockScreen } from './screens/PinLockScreen';
import { SellScreen } from './screens/SellScreen';

interface Device {
  handle: BrowserDriverHandle;
  driver: SqlDriver;
  store: StoreMeta;
  directory: StaffDirectory;
}

function useDevice(): Device | null {
  const [device, setDevice] = useState<Device | null>(null);
  useEffect(() => {
    let cancelled = false;
    void openDevice().then((handle) => {
      if (cancelled) return;
      const store = getStoreMeta(handle.driver);
      if (!store) throw new Error('device bootstrap: store missing after seed');
      setDevice({ handle, driver: handle.driver, store, directory: deviceStaffDirectory(handle.driver) });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return device;
}

export function App() {
  const device = useDevice();
  if (!device) return <BootScreen />;
  return <Register device={device} />;
}

function BootScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-bg">
      <p className="text-pos-body text-ink-muted">Starting register…</p>
    </div>
  );
}

type Screen = 'sell' | 'payment' | 'receipt';

type DiscountTarget = { kind: 'cart' } | { kind: 'line'; key: string };

function Register({ device }: { device: Device }) {
  const { driver, store, directory } = device;
  const [session, setSession] = useState<{ staffId: string; name: string; roleId: string } | null>(null);
  const [screen, setScreen] = useState<Screen>('sell');
  const [parkedCount, setParkedCount] = useState(0);
  const [queuedFacts, setQueuedFacts] = useState(0);
  const [discountTarget, setDiscountTarget] = useState<DiscountTarget | null>(null);
  const [customSaleOpen, setCustomSaleOpen] = useState(false);
  const [completed, setCompleted] = useState<{ sale: LocalSaleInput; change: number } | null>(null);
  const [taxCategories] = useState<TaxCategoryOption[]>(() => listTaxCategories(driver));
  const cart = useCart(store.currency, store.priceMode);

  const lock = useCallback(() => setSession(null), []);
  useIdleLock(session !== null, lock);

  const refreshCounters = useCallback(() => {
    setParkedCount(listParkedCarts(driver).length);
    setQueuedFacts(pendingCount(driver));
  }, [driver]);
  useEffect(() => {
    refreshCounters();
  }, [refreshCounters]);

  const staff = useMemo(
    () => (session ? { id: session.staffId, name: session.name } : null),
    [session],
  );

  return (
    <div className="relative min-h-screen">
      {staff && screen === 'sell' && (
        <SellScreen
          driver={driver}
          store={store}
          staff={staff}
          cart={cart}
          parkedCount={parkedCount}
          queuedFacts={queuedFacts}
          onLock={lock}
          onCharge={() => setScreen('payment')}
          onPark={() => {
            /* wired in T9 */
          }}
          onOpenParked={() => {
            /* wired in T9 */
          }}
          onOpenDiscount={() => setDiscountTarget({ kind: 'cart' })}
          onOpenLineDiscount={(key) => setDiscountTarget({ kind: 'line', key })}
          onOpenCustomSale={() => setCustomSaleOpen(true)}
        />
      )}

      {staff && discountTarget && (
        <DiscountSheet
          driver={driver}
          currency={store.currency}
          roleId={session!.roleId}
          target={discountTargetInfo(discountTarget, cart)}
          existing={existingDiscount(discountTarget, cart)}
          onApply={(discount, approvedBy, reason) => {
            const meta = { reason, approvedBy };
            if (discountTarget.kind === 'cart') cart.setCartDiscount(discount, meta);
            else cart.setLineDiscount(discountTarget.key, discount, meta);
            setDiscountTarget(null);
          }}
          onRemove={() => {
            if (discountTarget.kind === 'cart') cart.setCartDiscount(null);
            else cart.setLineDiscount(discountTarget.key, null);
            setDiscountTarget(null);
          }}
          onClose={() => setDiscountTarget(null)}
        />
      )}

      {staff && customSaleOpen && (
        <CustomSaleSheet
          currency={store.currency}
          taxCategories={taxCategories}
          onAdd={(input) => {
            cart.addCustom(input);
            setCustomSaleOpen(false);
          }}
          onClose={() => setCustomSaleOpen(false)}
        />
      )}

      {staff && screen === 'payment' && (
        <PaymentScreen
          driver={driver}
          store={store}
          staff={staff}
          cart={cart}
          onBack={() => setScreen('sell')}
          onComplete={(result) => {
            setCompleted(result);
            cart.clear();
            refreshCounters();
            setScreen('receipt');
          }}
        />
      )}

      {staff && screen === 'receipt' && completed && (
        <ReceiptPlaceholder
          change={completed.change}
          total={completed.sale.totals.total}
          currency={store.currency}
          onNewSale={() => {
            setCompleted(null);
            setScreen('sell');
          }}
        />
      )}

      {session === null && (
        <div className="absolute inset-0 z-10 bg-bg">
          <PinLockScreen
            directory={directory}
            storeName={store.name}
            registerName="Register 2"
            onUnlock={({ id, name, roleId }) => setSession({ staffId: id, name, roleId })}
          />
        </div>
      )}
    </div>
  );
}

// Discount targets a whole cart (base = pre-cart-discount total) or one line
// (base = its gross). Both feed the domain discount rules unchanged.
function discountTargetInfo(
  target: DiscountTarget,
  cart: ReturnType<typeof useCart>,
): { label: string; total: number } {
  if (target.kind === 'cart') {
    const base = cart.totals.lines.reduce((sum, l) => sum + l.netAmount + l.cartDiscountAmount, 0);
    return { label: 'Entire cart', total: base };
  }
  const line = cart.lines.find((l) => l.key === target.key);
  if (!line) return { label: 'Line', total: 0 };
  return { label: `${line.name} × ${line.qty}`, total: line.unitPriceAmount * line.qty };
}

function existingDiscount(target: DiscountTarget, cart: ReturnType<typeof useCart>): Discount | null {
  if (target.kind === 'cart') return cart.cart.cartDiscount;
  return cart.lines.find((l) => l.key === target.key)?.discounts[0] ?? null;
}

// Placeholder until T8 builds POS-05 Receipt.
function ReceiptPlaceholder({ change, total, currency, onNewSale }: { change: number; total: number; currency: string; onNewSale: () => void }) {
  const fmt = (n: number) => (n / 100).toLocaleString('en-PH', { style: 'currency', currency });
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-bg">
      <p className="text-h2 font-semibold text-success">Sale complete</p>
      <p className="text-pos-body text-ink-muted">Total {fmt(total)}</p>
      {change > 0 && <p className="text-pos-total font-semibold text-ink font-money tabular-nums">Change {fmt(change)}</p>}
      <p className="text-body-sm text-ink-muted">Receipt (print / email / QR) arrives in T8.</p>
      <button onClick={onNewSale} className="min-h-touch-pos rounded-card bg-primary px-8 py-3 text-pos-body font-semibold text-white">
        New sale
      </button>
    </div>
  );
}
