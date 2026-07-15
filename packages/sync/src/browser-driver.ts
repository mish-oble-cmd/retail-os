import type { SqlDriver } from './driver.js';
import { openSqlJsDriver } from './sqljs-driver.js';

/**
 * Browser device driver selection (1C). Opens a sql.js-backed `SqlDriver` and,
 * when the Origin Private File System (OPFS) is available, layers best-effort
 * snapshot persistence: the DB is loaded from an OPFS file on open and written
 * back after each commit. Where OPFS is unavailable (or blocked), it degrades
 * to pure in-memory and reports `persistent: false` so the app can surface the
 * "not certified for extended offline" warning (offline-sync-strategy.md).
 */

export interface BrowserDriverOptions {
  /** OPFS file name for the snapshot (default 'retailos.db') */
  fileName?: string;
  /** resolves the sql.js wasm asset URL (Vite passes an imported ?url) */
  locateFile?: (file: string) => string;
}

export interface BrowserDriverHandle {
  driver: SqlDriver;
  /** true when snapshots are being written to OPFS */
  persistent: boolean;
  /** force-write the current snapshot (e.g. on pagehide); no-op when in-memory */
  flush(): Promise<void>;
}

interface OpfsRootLike {
  getFileHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<{
    getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
    createWritable(): Promise<{
      write(data: Uint8Array): Promise<void>;
      close(): Promise<void>;
    }>;
  }>;
}

function opfsRoot(): Promise<OpfsRootLike> | null {
  const storage = (globalThis as { navigator?: { storage?: { getDirectory?: () => Promise<unknown> } } })
    .navigator?.storage;
  if (!storage?.getDirectory) return null;
  return storage.getDirectory() as Promise<OpfsRootLike>;
}

async function readSnapshot(root: OpfsRootLike, fileName: string): Promise<Uint8Array | undefined> {
  try {
    const handle = await root.getFileHandle(fileName);
    const file = await handle.getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    return bytes.byteLength > 0 ? bytes : undefined;
  } catch {
    return undefined; // no prior snapshot
  }
}

export async function openBrowserDriver(
  opts: BrowserDriverOptions = {},
): Promise<BrowserDriverHandle> {
  const fileName = opts.fileName ?? 'retailos.db';
  const rootPromise = opfsRoot();

  // In-memory fallback: no OPFS in this context.
  if (!rootPromise) {
    const driver = await openSqlJsDriver({ locateFile: opts.locateFile });
    return { driver, persistent: false, flush: async () => {} };
  }

  const root = await rootPromise;
  const data = await readSnapshot(root, fileName);

  // Serialize snapshot writes through a chain so bursts never interleave.
  let writeChain: Promise<void> = Promise.resolve();
  const write = (bytes: Uint8Array): Promise<void> => {
    writeChain = writeChain
      .then(async () => {
        const handle = await root.getFileHandle(fileName, { create: true });
        const writable = await handle.createWritable();
        await writable.write(bytes);
        await writable.close();
      })
      .catch(() => {
        // best-effort: a failed snapshot must never break the sell loop
      });
    return writeChain;
  };

  const driver = await openSqlJsDriver({
    data,
    locateFile: opts.locateFile,
    onPersist: (bytes) => {
      void write(bytes);
    },
  });

  return {
    driver,
    persistent: true,
    flush: () => write((driver as { export(): Uint8Array }).export()),
  };
}
