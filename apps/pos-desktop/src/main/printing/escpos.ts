import { Socket } from 'node:net';

/**
 * ESC/POS printing adapter (monorepo-structure.md rule 4: physical world
 * behind an interface). Network transport covers most commodity 58/80mm
 * printers (port 9100 raw); USB/serial transports are added in Phase 1 via
 * the same PrinterPort interface. Verified against the virtual printer in
 * tools/virtual-escpos-printer.mjs; real-hardware verification is a hardware
 * lab checklist item (06-apps/pos-desktop.md).
 */

export interface PrinterPort {
  write(data: Uint8Array): Promise<void>;
}

const ESC = 0x1b;
const GS = 0x1d;

class ReceiptBuilder {
  private readonly bytes: number[] = [ESC, 0x40]; // initialize

  align(mode: 'left' | 'center' | 'right'): this {
    this.bytes.push(ESC, 0x61, mode === 'left' ? 0 : mode === 'center' ? 1 : 2);
    return this;
  }

  bold(on: boolean): this {
    this.bytes.push(ESC, 0x45, on ? 1 : 0);
    return this;
  }

  doubleSize(on: boolean): this {
    this.bytes.push(GS, 0x21, on ? 0x11 : 0x00);
    return this;
  }

  line(text = ''): this {
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      // Phase 0: ASCII only; codepage handling (₱ etc.) comes with the real
      // receipt templates. Currency prints as "PHP" on paper for now.
      this.bytes.push(code <= 0x7f ? code : 0x3f /* ? */);
    }
    this.bytes.push(0x0a);
    return this;
  }

  feed(lines: number): this {
    this.bytes.push(ESC, 0x64, lines);
    return this;
  }

  cut(): this {
    this.bytes.push(GS, 0x56, 0x00);
    return this;
  }

  build(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

export function buildTestReceipt(now: Date = new Date()): Uint8Array {
  return new ReceiptBuilder()
    .align('center')
    .doubleSize(true)
    .line('RetailOS')
    .doubleSize(false)
    .line('Bahay Kubo Grocers')
    .line('Register 2 - Poblacion branch')
    .line()
    .bold(true)
    .line('*** TEST RECEIPT ***')
    .bold(false)
    .line(now.toISOString())
    .line()
    .align('left')
    .line('Printer check          PHP 0.00')
    .line('VAT 12% (included)     PHP 0.00')
    .line()
    .align('center')
    .line('This is NOT an official receipt.')
    .feed(3)
    .cut()
    .build();
}

export class NetworkPrinterPort implements PrinterPort {
  constructor(
    private readonly host: string,
    private readonly port = 9100,
    private readonly timeoutMs = 5000,
  ) {}

  write(data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      const fail = (error: Error) => {
        socket.destroy();
        reject(error);
      };
      socket.setTimeout(this.timeoutMs, () => fail(new Error('printer connection timed out')));
      socket.once('error', fail);
      // Resolve on close, not on local flush — the receipt has actually left.
      socket.once('close', (hadError) => {
        if (!hadError) resolve();
      });
      socket.connect(this.port, this.host, () => {
        socket.end(Buffer.from(data));
      });
    });
  }
}

export async function printTestReceipt(port: PrinterPort): Promise<void> {
  await port.write(buildTestReceipt());
}
