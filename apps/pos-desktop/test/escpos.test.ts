/**
 * Proves the Phase 0 exit criterion "prints a test receipt to a virtual
 * ESC/POS printer" headlessly: a real TCP round-trip from the printing
 * adapter to an in-test raw-print server.
 */
import { createServer, type Server } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildTestReceipt,
  NetworkPrinterPort,
  printTestReceipt,
} from '../src/main/printing/escpos';

let server: Server;
let port: number;
let nextReceipt: Promise<Buffer>;
let deliverReceipt: (data: Buffer) => void;

beforeAll(async () => {
  nextReceipt = new Promise((resolve) => {
    deliverReceipt = resolve;
  });
  server = createServer((socket) => {
    const chunks: Buffer[] = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('end', () => deliverReceipt(Buffer.concat(chunks)));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  port = address.port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('ESC/POS printing spike', () => {
  it('builds a receipt that initializes, prints ASCII, and cuts', () => {
    const receipt = Buffer.from(buildTestReceipt(new Date('2026-07-09T12:00:00Z')));
    expect(receipt.subarray(0, 2)).toEqual(Buffer.from([0x1b, 0x40])); // ESC @
    expect(receipt.toString('latin1')).toContain('*** TEST RECEIPT ***');
    expect(receipt.toString('latin1')).toContain('Bahay Kubo Grocers');
    const cutAt = receipt.indexOf(Buffer.from([0x1d, 0x56, 0x00]));
    expect(cutAt).toBeGreaterThan(0); // GS V 0 full cut present
  });

  it('delivers the receipt over the network to a virtual printer', async () => {
    await printTestReceipt(new NetworkPrinterPort('127.0.0.1', port));
    const received = await nextReceipt;
    expect(received.length).toBeGreaterThan(0);
    expect(received.toString('latin1')).toContain('*** TEST RECEIPT ***');
    expect(received.indexOf(Buffer.from([0x1d, 0x56, 0x00]))).toBeGreaterThan(0);
  });

  it('fails cleanly when no printer is listening', async () => {
    const dead = new NetworkPrinterPort('127.0.0.1', 1, 500);
    await expect(printTestReceipt(dead)).rejects.toThrow();
  });
});
