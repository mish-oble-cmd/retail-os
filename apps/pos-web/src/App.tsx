import { useState } from 'react';
import { PinLockScreen } from './screens/PinLockScreen';
import { SellShellScreen } from './screens/SellShellScreen';

export function App() {
  const [unlocked, setUnlocked] = useState(false);
  return unlocked ? (
    <SellShellScreen onLock={() => setUnlocked(false)} />
  ) : (
    <PinLockScreen onUnlock={() => setUnlocked(true)} />
  );
}
