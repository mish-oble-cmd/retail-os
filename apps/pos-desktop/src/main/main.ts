import { app, BrowserWindow, ipcMain } from 'electron';
import { NetworkPrinterPort, printTestReceipt } from './printing/escpos';

/**
 * Desktop shell (AD-5): wraps the pos-web build. Phase 0 proves the three
 * risky integrations — window shell, ESC/POS printing, auto-update wiring.
 */

const POS_WEB_URL = process.env['POS_WEB_URL'] ?? 'http://localhost:5173';

function wireAutoUpdater(): void {
  // electron-updater only functions in a packaged build with a publish config
  // (electron-builder → GitHub Releases, deployment-devops.md). Wired now so
  // Phase 1 packaging only adds config, not code.
  if (!app.isPackaged) return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');
  void autoUpdater.checkForUpdatesAndNotify();
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    fullscreenable: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await window.loadURL(POS_WEB_URL);
}

ipcMain.handle('print-test-receipt', async (_event, printerHost: string, printerPort?: number) => {
  await printTestReceipt(new NetworkPrinterPort(printerHost, printerPort ?? 9100));
  return { ok: true };
});

void app.whenReady().then(() => {
  wireAutoUpdater();
  void createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
