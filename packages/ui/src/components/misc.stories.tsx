import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Badge } from './badge.js';
import { Button } from './button.js';
import { Card } from './card.js';
import { DataTable, type DataTableColumn } from './data-table.js';
import { Modal } from './modal.js';
import { MoneyText } from './money-text.js';
import { Toast } from './toast.js';

const meta: Meta = { title: 'Primitives/Badge · Card · Modal · Toast · DataTable · MoneyText' };
export default meta;

export const Badges: StoryObj = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge>Draft</Badge>
      <Badge tone="success">Synced</Badge>
      <Badge tone="warning">Offline · 3 queued</Badge>
      <Badge tone="danger">Refunded</Badge>
      <Badge tone="accent">Pending</Badge>
    </div>
  ),
};

export const Cards: StoryObj = {
  render: () => (
    <Card
      title="Top items today"
      actions={
        <Button variant="ghost" size="sm">
          Export CSV
        </Button>
      }
      className="max-w-md"
    >
      <p className="text-body-sm text-ink-muted">
        Dried Mangoes 200g leads with ₱8,510.00 across 46 units.
      </p>
    </Card>
  ),
};

function ModalDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open modal</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Discard parked cart?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Keep cart
            </Button>
            <Button variant="danger" onClick={() => setOpen(false)}>
              Discard
            </Button>
          </>
        }
      >
        <p className="text-body-sm text-ink">
          “Aling Rosa — hold until 5pm” has 4 items worth{' '}
          <MoneyText amount={78500} currency="PHP" />. This can’t be undone.
        </p>
      </Modal>
    </>
  );
}

export const ModalStory: StoryObj = { name: 'Modal', render: () => <ModalDemo /> };

export const Toasts: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Toast tone="success" onDismiss={() => {}}>
        Sale R2-000482 synced.
      </Toast>
      <Toast tone="warning" onDismiss={() => {}}>
        Offline — sales are saved on this device.
      </Toast>
      <Toast tone="danger" onDismiss={() => {}}>
        Printer not responding. Check the USB cable, then retry.
      </Toast>
      <Toast>Receipt emailed to aling.nena@example.ph.</Toast>
    </div>
  ),
};

interface ItemRow {
  id: string;
  name: string;
  qty: number;
  revenue: number;
}

const rows: ItemRow[] = [
  { id: '1', name: 'Dried Mangoes 200g', qty: 46, revenue: 851000 },
  { id: '2', name: 'Barako Coffee Beans 250g', qty: 21, revenue: 672000 },
  { id: '3', name: 'Ube Halaya Jar 340g', qty: 33, revenue: 544500 },
];

const columns: DataTableColumn<ItemRow>[] = [
  { key: 'name', header: 'Item', render: (r) => r.name },
  { key: 'qty', header: 'Qty', align: 'right', render: (r) => r.qty },
  {
    key: 'revenue',
    header: 'Revenue',
    align: 'right',
    render: (r) => <MoneyText amount={r.revenue} currency="PHP" />,
  },
];

export const DataTableStory: StoryObj = {
  name: 'DataTable',
  render: () => (
    <div className="max-w-xl">
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        footer={{ name: 'Total', revenue: <MoneyText amount={2067500} currency="PHP" /> }}
      />
    </div>
  ),
};

export const DataTableEmpty: StoryObj = {
  render: () => (
    <div className="max-w-xl">
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(r: ItemRow) => r.id}
        empty={
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="text-body font-medium text-ink">No sales yet today</p>
            <p className="text-body-sm text-ink-muted">
              Ring your first sale on the register and it lands here.
            </p>
            <Button size="sm">Add products</Button>
          </div>
        }
      />
    </div>
  ),
};

export const MoneyTextStory: StoryObj = {
  name: 'MoneyText',
  render: () => (
    <div className="flex flex-col items-end gap-1 font-money">
      <MoneyText amount={125000} currency="PHP" />
      <MoneyText amount={13393} currency="PHP" />
      <MoneyText amount={-4500} currency="PHP" />
      <MoneyText amount={1250} currency="JPY" locale="en" />
    </div>
  ),
};
