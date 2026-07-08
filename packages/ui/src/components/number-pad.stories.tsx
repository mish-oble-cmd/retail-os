import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { MoneyText } from './money-text.js';
import { NumberPad } from './number-pad.js';

const meta: Meta<typeof NumberPad> = {
  title: 'Primitives/NumberPad',
  component: NumberPad,
};
export default meta;

type Story = StoryObj<typeof NumberPad>;

function MoneyEntry() {
  const [amount, setAmount] = useState(200000);
  return (
    <div className="flex w-72 flex-col gap-3">
      <div className="flex h-16 items-center justify-end rounded border-2 border-primary bg-surface px-4 text-h1 font-semibold">
        <MoneyText amount={amount} currency="PHP" />
      </div>
      <NumberPad value={amount} onChange={setAmount} />
    </div>
  );
}

export const MoneyEntryPad: Story = { render: () => <MoneyEntry /> };

function PinEntry() {
  const [pin, setPin] = useState(0);
  const digits = pin === 0 ? '' : String(pin);
  return (
    <div className="flex w-72 flex-col gap-3">
      <div className="flex h-16 items-center justify-center rounded border border-border bg-surface text-h1 tracking-[0.5em]">
        {'•'.repeat(digits.length) || <span className="text-ink-muted text-body">Enter PIN</span>}
      </div>
      <NumberPad value={pin} onChange={setPin} doubleZero={false} max={999999} />
    </div>
  );
}

export const PinPad: Story = { render: () => <PinEntry /> };
