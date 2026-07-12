import {
  discardParkedCart,
  getStoreMeta,
  listParkedCarts,
  parkCart,
  pendingCount,
  retrieveParkedCart,
  type BrowserDriverHandle,
  type LocalSaleInput,
  type ParkedCartSummary,
  type SqlDriver,
  type StoreMeta,
} from '@retailos/sync';
import type { Discount } from '@retailos/domain';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCart, type Cart } from './lib/cart';
import { listTaxCategories, openDevice, type TaxCategoryOption } from './lib/device';
import { deviceStaffDirectory, type StaffDirectory } from './lib/staff-directory';
import { useIdleLock } from './lib/use-idle-lock';
import { CustomSaleSheet } from './screens/CustomSaleSheet';
import { DiscountSheet } from './screens/DiscountSheet';
import { OrdersScreen } from './screens/OrdersScreen';
import { RefundScreen } from './screens/RefundScreen';
import { ParkCartDialog } from './screens/ParkCartDialog';
import { ParkedCartsSheet } from './screens/ParkedCartsSheet';
import { PaymentScreen } from './screens/PaymentScreen';
import { PinLockScreen } from './screens/PinLockScreen';
import { ReceiptScreen } from './screens/ReceiptScreen';
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

type Screen = 'sell' | 'payment' | 'receipt' | 'orders' | 'refund';

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
  const [refundOrderId, setRefundOrderId] = useState<string | null>(null);
  const [parkOpen, setParkOpen] = useState(false);
  const [parkedOpen, setParkedOpen] = useState(false);
  const [parked, setParked] = useState<ParkedCartSummary[]>([]);
  const [staffNameById, setStaffNameById] = useState<Map<string, string>>(new Map());
  const [taxCategories] = useState<TaxCategoryOption[]>(() => listTaxCategories(driver));
  const cart = useCart(store.currency, store.priceMode);

  const lock = useCallback(() => setSession(null), []);
  useIdleLock(session !== null, lock);

  const refreshCounters = useCallback(() => {
    const list = listParkedCarts(driver);
    setParked(list);
    setParkedCount(list.length);
    setQueuedFacts(pendingCount(driver));
  }, [driver]);
  useEffect(() => {
    refreshCounters();
    void directory.listStaff().then((rows) => setStaffNameById(new Map(rows.map((s) => [s.id, s.name]))));
  }, [refreshCounters, directory]);

  const staff = useMemo(
    () => (session ? { id: session.staffId, name: session.name } : null),
    [session],
  );

  const doPark = useCallback(
    (name: string) => {
      parkCart(driver, {
        name,
        staffId: session?.staffId ?? null,
        cart: cart.cart,
        itemCount: cart.itemCount,
        totalAmount: cart.totals.totalAmount,
        currency: store.currency,
      });
      cart.clear();
      setParkOpen(false);
      refreshCounters();
    },
    [driver, session, cart, store.currency, refreshCounters],
  );

  const doRetrieve = useCallback(
    (id: string) => {
      // Collision rule: a non-empty current cart is re-parked before retrieving.
      if (cart.lines.length > 0) {
        parkCart(driver, {
          name: `Unnamed — ${new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}`,
          staffId: session?.staffId ?? null,
          cart: cart.cart,
          itemCount: cart.itemCount,
          totalAmount: cart.totals.totalAmount,
          currency: store.currency,
        });
      }
      const retrieved = retrieveParkedCart<Cart>(driver, id);
      if (retrieved) cart.replace(retrieved.cart);
      setParkedOpen(false);
      refreshCounters();
    },
    [driver, session, cart, store.currency, refreshCounters],
  );

  const doDiscard = useCallback(
    (id: string) => {
      discardParkedCart(driver, id);
      refreshCounters();
    },
    [driver, refreshCounters],
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
          onOpenOrders={() => setScreen('orders')}
          onCharge={() => setScreen('payment')}
          onPark={() => setParkOpen(true)}
          onOpenParked={() => setParkedOpen(true)}
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

      {staff && parkOpen && (
        <ParkCartDialog
          itemCount={cart.itemCount}
          total={cart.totals.totalAmount}
          currency={store.currency}
          parkedCount={parkedCount}
          onPark={doPark}
          onViewParked={() => { setParkOpen(false); setParkedOpen(true); }}
          onClose={() => setParkOpen(false)}
        />
      )}

      {staff && parkedOpen && (
        <ParkedCartsSheet
          parked={parked}
          currency={store.currency}
          currentItemCount={cart.itemCount}
          staffNameById={staffNameById}
          onRetrieve={doRetrieve}
          onDiscard={doDiscard}
          onClose={() => setParkedOpen(false)}
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
        <ReceiptScreen
          store={store}
          staffName={staff.name}
          sale={completed.sale}
          change={completed.change}
          onNewSale={() => {
            setCompleted(null);
            setScreen('sell');
          }}
        />
      )}

      {staff && screen === 'orders' && (
        <OrdersScreen
          driver={driver}
          store={store}
          onBack={() => setScreen('sell')}
          onStartRefund={(orderId) => {
            setRefundOrderId(orderId);
            setScreen('refund');
          }}
        />
      )}

      {staff && screen === 'refund' && refundOrderId && session && (
        <RefundScreen
          driver={driver}
          store={store}
          orderId={refundOrderId}
          staff={{ id: session.staffId, roleId: session.roleId }}
          onBack={() => setScreen('orders')}
          onDone={() => {
            refreshCounters();
            setRefundOrderId(null);
            setScreen('orders');
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
