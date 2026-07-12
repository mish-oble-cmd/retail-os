import { getStoreMeta, listParkedCarts, pendingCount, type BrowserDriverHandle, type SqlDriver, type StoreMeta } from '@retailos/sync';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCart } from './lib/cart';
import { openDevice } from './lib/device';
import { deviceStaffDirectory, type StaffDirectory } from './lib/staff-directory';
import { useIdleLock } from './lib/use-idle-lock';
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

type Screen = 'sell' | 'payment';

function Register({ device }: { device: Device }) {
  const { driver, store, directory } = device;
  const [session, setSession] = useState<{ staffId: string; name: string } | null>(null);
  const [screen, setScreen] = useState<Screen>('sell');
  const [parkedCount, setParkedCount] = useState(0);
  const [queuedFacts, setQueuedFacts] = useState(0);
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
          onOpenDiscount={() => {
            /* wired in T6 */
          }}
          onOpenCustomSale={() => {
            /* wired in T6 */
          }}
        />
      )}

      {staff && screen === 'payment' && (
        <PaymentPlaceholder total={cart.totals.totalAmount} currency={store.currency} onBack={() => setScreen('sell')} />
      )}

      {session === null && (
        <div className="absolute inset-0 z-10 bg-bg">
          <PinLockScreen
            directory={directory}
            storeName={store.name}
            registerName="Register 2"
            onUnlock={({ id, name }) => setSession({ staffId: id, name })}
          />
        </div>
      )}
    </div>
  );
}

// Placeholder until T7 builds POS-04 Payment.
function PaymentPlaceholder({ total, currency, onBack }: { total: number; currency: string; onBack: () => void }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-bg">
      <p className="text-pos-total font-semibold text-ink font-money tabular-nums">
        {(total / 100).toLocaleString('en-PH', { style: 'currency', currency })}
      </p>
      <p className="text-pos-body text-ink-muted">Payment screen arrives in T7.</p>
      <button onClick={onBack} className="min-h-touch-pos rounded border border-border bg-surface px-6 text-body text-ink">
        Back to sell
      </button>
    </div>
  );
}
