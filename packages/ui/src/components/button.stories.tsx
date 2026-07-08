import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './button.js';

const meta: Meta<typeof Button> = {
  title: 'Primitives/Button',
  component: Button,
};
export default meta;

type Story = StoryObj<typeof Button>;

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary">Charge ₱1,250.00</Button>
      <Button variant="secondary">Park cart</Button>
      <Button variant="ghost">Cancel</Button>
      <Button variant="danger">Void sale</Button>
      <Button variant="primary" disabled>
        Charge ₱0.00
      </Button>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm">Small</Button>
      <Button size="md">Medium (admin)</Button>
      <Button size="pos">POS — 48px target</Button>
    </div>
  ),
};
