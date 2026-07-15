import { Injectable, NotFoundException } from '@nestjs/common';
import { formatMoney, money } from '@retailos/domain';
import { eq } from 'drizzle-orm';
import { MailerService } from '../../common/mailer';
import { DbService } from '../../db/db.service';
import { orderLines, orders, payments, staff, stores } from '../../db/schema';

/**
 * Public web receipt (1C, tech-stack.md `/r/<order-ulid>`). No auth: the order
 * ULID is the capability. The store is resolved from the order id via a
 * cross-tenant lookup, then all reads happen inside that store's RLS context.
 */
export interface ReceiptView {
  order: {
    id: string;
    number: string;
    state: string;
    currency: string;
    subtotal_amount: number;
    discount_amount: number;
    tax_amount: number;
    total_amount: number;
    created_at: string | null;
  };
  store: { name: string };
  cashier: string | null;
  lines: { name: string; qty: number; total_amount: number }[];
  payments: { tender_type: string; amount: number; change_amount: number }[];
}

@Injectable()
export class ReceiptService {
  constructor(
    private readonly db: DbService,
    private readonly mailer: MailerService,
  ) {}

  private async resolveStoreId(orderId: string): Promise<string> {
    const storeId = await this.db.tenants.dangerouslyCrossTenant(
      'public receipt: resolve store from order ulid',
      async (tx) => {
        const [row] = await tx.select({ storeId: orders.storeId }).from(orders).where(eq(orders.id, orderId));
        return row?.storeId ?? null;
      },
    );
    if (!storeId) throw new NotFoundException('receipt not found');
    return storeId;
  }

  async getReceipt(orderId: string): Promise<ReceiptView> {
    const storeId = await this.resolveStoreId(orderId);
    return this.db.tenants.forStore(storeId).tx(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
      if (!order) throw new NotFoundException('receipt not found');
      const [store] = await tx.select().from(stores).where(eq(stores.id, storeId));
      const cashier = order.staffId
        ? (await tx.select({ name: staff.name }).from(staff).where(eq(staff.id, order.staffId)))[0]?.name ?? null
        : null;
      const lines = await tx
        .select({ name: orderLines.name, qty: orderLines.qty, totalAmount: orderLines.totalAmount })
        .from(orderLines)
        .where(eq(orderLines.orderId, orderId));
      const pays = await tx
        .select({ tenderType: payments.tenderType, amount: payments.amount, changeAmount: payments.changeAmount })
        .from(payments)
        .where(eq(payments.orderId, orderId));

      return {
        order: {
          id: order.id,
          number: order.number,
          state: order.state,
          currency: order.currency,
          subtotal_amount: order.subtotalAmount,
          discount_amount: order.discountAmount,
          tax_amount: order.taxAmount,
          total_amount: order.totalAmount,
          created_at: order.clientCreatedAt?.toISOString() ?? order.receivedAt?.toISOString() ?? null,
        },
        store: { name: store?.name ?? 'RetailOS' },
        cashier,
        lines: lines.map((l) => ({ name: l.name, qty: l.qty, total_amount: l.totalAmount })),
        payments: pays.map((p) => ({ tender_type: p.tenderType, amount: p.amount, change_amount: p.changeAmount })),
      };
    });
  }

  async emailReceipt(orderId: string, email: string): Promise<void> {
    const receipt = await this.getReceipt(orderId);
    const html = renderReceiptHtml(receipt);
    await this.mailer.send({
      to: email,
      subject: `Receipt ${receipt.order.number} — ${receipt.store.name}`,
      html,
      text: `Receipt ${receipt.order.number} from ${receipt.store.name}. Total ${fmt(receipt.order.total_amount, receipt.order.currency)}.`,
    });
  }
}

const fmt = (amount: number, currency: string) => formatMoney(money(amount, currency));

function renderReceiptHtml(r: ReceiptView): string {
  const rows = r.lines
    .map((l) => `<tr><td>${escapeHtml(l.name)} ×${l.qty}</td><td style="text-align:right">${fmt(l.total_amount, r.order.currency)}</td></tr>`)
    .join('');
  const pays = r.payments
    .map((p) => `<tr><td>${p.tender_type === 'cash' ? 'Cash' : 'Card'}</td><td style="text-align:right">${fmt(p.amount + p.change_amount, r.order.currency)}</td></tr>`)
    .join('');
  const vatable = r.order.total_amount - r.order.tax_amount;
  return `<div style="font-family:ui-monospace,monospace;max-width:320px">
    <h2 style="text-align:center;margin:0">${escapeHtml(r.store.name)}</h2>
    <p style="text-align:center;color:#666;margin:4px 0">${escapeHtml(r.order.number)}${r.cashier ? ` · ${escapeHtml(r.cashier)}` : ''}</p>
    <table style="width:100%;border-collapse:collapse">${rows}
      <tr><td colspan="2"><hr/></td></tr>
      <tr><td><strong>TOTAL</strong></td><td style="text-align:right"><strong>${fmt(r.order.total_amount, r.order.currency)}</strong></td></tr>
      ${pays}
      <tr><td>VATable sales</td><td style="text-align:right">${fmt(vatable, r.order.currency)}</td></tr>
      <tr><td>VAT</td><td style="text-align:right">${fmt(r.order.tax_amount, r.order.currency)}</td></tr>
    </table>
    <p style="text-align:center;color:#666">Salamat po!</p>
  </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
