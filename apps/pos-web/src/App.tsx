import { useCallback, useState } from 'react';
import { demoStaffDirectory } from './lib/staff-directory';
import { useIdleLock } from './lib/use-idle-lock';
import { PinLockScreen } from './screens/PinLockScreen';
import { SellShellScreen } from './screens/SellShellScreen';

const directory = demoStaffDirectory();

export function App() {
  const [session, setSession] = useState<{ staffId: string; name: string } | null>(null);
  const lock = useCallback(() => setSession(null), []);
  useIdleLock(session !== null, lock);

  // SellShell stays mounted behind the lock so in-progress state survives
  // the 90 s auto-lock (FR-5.1: cart preserved and restored on unlock).
  return (
    <div className="relative min-h-screen">
      <SellShellScreen staffName={session?.name ?? null} onLock={lock} />
      {session === null ? (
        <div className="absolute inset-0 z-10 bg-bg">
          <PinLockScreen
            directory={directory}
            storeName="Bahay Kubo Grocers"
            registerName="Register 1"
            onUnlock={({ id, name }) => setSession({ staffId: id, name })}
          />
        </div>
      ) : null}
    </div>
  );
}
