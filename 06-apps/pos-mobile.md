# App Spec — Mobile POS (`apps/pos-mobile`)

React Native (Expo) app for Android + iOS phones and small tablets. Ships in Phase 3. The "market stall / pop-up / queue-busting" register: camera scanning, BLE printing, pocketable.

## Product stance

Full sell-path parity with desktop (sell, tenders, park, refunds, shifts, receipts); back-office tasks stay in admin (open in browser). Phone-portrait-first; tablet gets a two-pane layout later (Could).

## Navigation (portrait)

```
Bottom tabs:  [Sell]  [Cart (badge)]  [Orders]  [Shift]  [More]
Sell tab:     search bar · camera-scan button (persistent) · product grid
Cart tab:     lines → swipe qty/remove · discount · customer chip · CHARGE (sticky)
Payment:      full-screen tender flow (same domain logic, same receipts)
More:         stock lookup · settings/diagnostics · lock (PIN)
```

## Mobile-specific implementation

- **Scanning**: expo-camera + ML Kit/Vision barcode; continuous-scan mode (beep + haptic per item, cart badge counts up) for queue busting; wired scanner support on Android via USB-OTG keyboard wedge
- **Printing**: BLE + TCP ESC/POS adapters implementing the same `ReceiptPrinter` interface; share-as-PDF and QR-receipt fallbacks make printers optional
- **Storage/sync**: expo-sqlite + SQLCipher; identical `@retailos/sync` engine; background sync via expo-task-manager (best-effort; foreground sync is the guarantee)
- **UI**: NativeWind + tokens from `packages/ui/tokens`; components rebuilt native (no web-DOM sharing) but MoneyText/NumberPad/TenderButton mirror web APIs 1:1
- **Auth**: activation code → device token in SecureStore; PIN lock with biometric-unlock-of-PIN convenience option
- **Lifecycle**: cart persisted on every mutation; app kill/restore returns to exact state; auto-lock on background > 60s
- **OTA**: EAS Update for JS-layer fixes; store releases for native changes; update never interrupts an open cart

## Platform notes

Android is the primary target (launch-market device reality — cheap tablets/phones); iOS must pass but optimizes second. Min: Android 8 / iOS 15. Test matrix includes a $120 Android tablet — if it's smooth there, it's smooth everywhere.

## Acceptance (Phase 3)

Runs the Phase 1 demo script (minus desktop-only items) on both platforms + continuous-scan of 20 items in < 60s + BLE receipt print + full offline day then clean sync.
