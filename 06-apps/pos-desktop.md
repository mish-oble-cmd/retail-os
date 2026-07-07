# App Spec — Desktop POS (`apps/pos-desktop` + `apps/pos-web`)

The flagship register: Electron shell (`pos-desktop`) loading the React POS (`pos-web`, also runnable in a browser). Landscape, touch-or-keyboard, offline-certified.

## Target hardware
Windows 10+ / macOS 12+ / Ubuntu LTS; 2019-era i5 / 8GB reference machine (NFR-2 budgets measured here). Touchscreen optional — **every flow must be operable keyboard-only** (many counters have no touch).

## Layout (1280×800 reference, per approved POS-03 mockup)

```
┌──────────────────────────────┬───────────────────────┐
│  [Search / scan focus bar]   │  Cart                 │
│  ┌────┐┌────┐┌────┐┌────┐    │  2× T-Shirt M   998.00│
│  │tile││tile││tile││tile│    │  1× Cap         250.00│
│  └────┘└────┘└────┘└────┘    │  ─────────────────────│
│  category tabs · pagination  │  Subtotal / VAT       │
│                              │  ┌───────────────────┐│
│ [Park] [Orders] [Shift] [⚙]  │  │  CHARGE ₱1,248.00 ││
│              sync ● offline  │  └───────────────────┘│
└──────────────────────────────┴───────────────────────┘
```

## Keyboard & scanner model
- Barcode scanners are keyboard wedges: a hidden focus-trap input always captures scan bursts (fast keystrokes + Enter) regardless of UI focus; heuristic distinguishes scans from typing
- Shortcuts: `F1` search · `F2` custom sale · `F4` discount · `F8` park · `F9` retrieve · `F12`/`Enter` pay · `Esc` back · `+/-` qty on selected line · number row = quick cash amounts on payment screen
- Shortcut cheat-sheet on `?`

## Electron main-process responsibilities (the only Electron-specific code)
- **Printing**: ESC/POS via USB/network/serial (adapter interface `ReceiptPrinter`); cash drawer kick (printer pulse); print spooler with retry + "printer offline" toast; test-print in POS-12
- **Auto-update**: electron-updater, staged rollouts, never mid-shift restarts (defer until shift close or idle)
- **Storage**: better-sqlite3 (SQLCipher), OS-keychain for device token
- Kiosk-ish mode: fullscreen default, exit gated by manager PIN
- Crash recovery: relaunch restores in-progress cart from last SQLite write

## IPC contract
Renderer ↔ main via typed IPC (`print(receiptModel)`, `openDrawer()`, `getDeviceInfo()`, `updateStatus()`). `pos-web` in a plain browser gets no-op/HTML-print fallbacks of the same interface — one codebase, capability-detected.

## Offline behavior
Certified offline per `03-architecture/offline-sync-strategy.md`. Status pill states: ● synced · ◐ N pending · ○ offline (calm warning, never blocking). Browser mode: online-preferred with honest banner (Phase 3 decision).

## Hardware compatibility (maintain as certified — Phase 4 workstream 4E)

| Device | Model | Status |
|---|---|---|
| Receipt printer | Epson TM-T82/T88, XPrinter XP-58/80 | ☐ to certify |
| Cash drawer | Any RJ11-via-printer | ☐ |
| Scanner | Honeywell Voyager, generic 2D USB | ☐ |
| Card reader | Stripe WisePOS E / market-specific | ☐ P4 |
