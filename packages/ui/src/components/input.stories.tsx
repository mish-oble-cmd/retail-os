import type { Meta, StoryObj } from '@storybook/react';
import { Input } from './input.js';

const meta: Meta<typeof Input> = {
  title: 'Primitives/Input',
  component: Input,
};
export default meta;

type Story = StoryObj<typeof Input>;

export const States: Story = {
  render: () => (
    <div className="flex max-w-sm flex-col gap-4">
      <Input label="Store name" placeholder="Bahay Kubo Grocers" />
      <Input
        label="Email"
        hint="Used for sign-in and receipts"
        placeholder="aling.nena@example.ph"
      />
      <Input
        label="Card reference"
        defaultValue="4539 8801 2345 6721"
        error="Enter the last 4 digits only — full card numbers are never stored."
      />
      <Input label="Disabled" disabled placeholder="—" />
    </div>
  ),
};
