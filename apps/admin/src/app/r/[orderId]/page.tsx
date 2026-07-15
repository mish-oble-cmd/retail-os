'use client';

import { useEffect, useState } from 'react';

/**
 * Public web receipt (POS-05 QR target, tech-stack.md /r/<order-ulid>). No
 * auth — the ULID in the URL is the capability. Fetches the read-only receipt
 * view from the API's public surface and renders a printable slip.
 */

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

interface ReceiptView {
  order: {
    number: string;
    currency: string;
    tax_amount: number;
    total_amount: number;
    created_at: string | null;
  };
  store: { name: string };
  cashier: string | null;
  lines: { name: string; qty: number; total_amount: number }[];
  payments: { tender_type: string; amount: number; change_amount: number }[];
}

export default function ReceiptPage({ params }: { params: { orderId: string } }) {
  const [receipt, setReceipt] = useState<ReceiptView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/v1/public/receipts/${params.orderId}`)
      .then((res) => (res.ok ? (res.json() as Promise<ReceiptView>) : Promise.reject(new Error(String(res.status)))))
      .then(setReceipt)
      .catch(() => setError('This receipt could not be found.'));
  }, [params.orderId]);

  if (error) {
    return (
      <main style={pageStyle}>
        <p style={{ color: '#5C6660' }}>{error}</p>
      </main>
    );
  }
  if (!receipt) {
    return (
      <main style={pageStyle}>
        <p style={{ color: '#5C6660' }}>Loading receipt…</p>
      </main>
    );
  }

  const fmt = (amount: number) =>
    new Intl.NumberFormat('en-PH', { style: 'currency', currency: receipt.order.currency }).format(amount / 100);
  const vatable = receipt.order.total_amount - receipt.order.tax_amount;

  return (
    <main style={pageStyle}>
      <div style={slipStyle}>
        <h1 style={{ textAlign: 'center', fontSize: 18, margin: 0 }}>{receipt.store.name}</h1>
        <p style={{ textAlign: 'center', color: '#5C6660', margin: '4px 0' }}>
          {receipt.order.number}
          {receipt.cashier ? ` · ${receipt.cashier}` : ''}
        </p>
        {receipt.order.created_at && (
          <p style={{ textAlign: 'center', color: '#5C6660', margin: 0, fontSize: 13 }}>
            {new Date(receipt.order.created_at).toLocaleString('en-PH')}
          </p>
        )}
        <hr style={hr} />
        {receipt.lines.map((l, i) => (
          <Row key={i} left={`${l.name} ×${l.qty}`} right={fmt(l.total_amount)} />
        ))}
        <hr style={hr} />
        <Row bold left="TOTAL" right={fmt(receipt.order.total_amount)} />
        {receipt.payments.map((p, i) => (
          <Row key={i} left={p.tender_type === 'cash' ? 'Cash' : 'Card'} right={fmt(p.amount + p.change_amount)} />
        ))}
        <hr style={hr} />
        <Row left="VATable sales" right={fmt(vatable)} />
        <Row left="VAT" right={fmt(receipt.order.tax_amount)} />
        <p style={{ textAlign: 'center', color: '#5C6660', marginTop: 16 }}>Salamat po!</p>
      </div>
    </main>
  );
}

function Row({ left, right, bold }: { left: string; right: string; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: bold ? 600 : 400 }}>
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'flex-start',
  background: '#F7F8F7',
  padding: 24,
};
const slipStyle: React.CSSProperties = {
  width: 340,
  background: '#fff',
  border: '1px solid #E2E6E3',
  borderRadius: 12,
  padding: 24,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  fontSize: 14,
  color: '#1C1F1D',
};
const hr: React.CSSProperties = { border: 0, borderTop: '1px dashed #E2E6E3', margin: '8px 0' };
