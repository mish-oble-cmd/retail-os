import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { ReceiptService, type ReceiptView } from './receipt.service';

const ulidSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'must be a ULID');
const emailBody = z.object({ email: z.string().email() });

/**
 * Public receipt surface — no auth (the order ULID is the capability). Backs
 * the QR web receipt and the "email me a receipt" action from POS-05.
 */
@Controller('public/receipts')
export class ReceiptController {
  constructor(private readonly receipts: ReceiptService) {}

  @Get(':orderId')
  get(@Param('orderId') orderId: string): Promise<ReceiptView> {
    return this.receipts.getReceipt(ulidSchema.parse(orderId));
  }

  @Post(':orderId/email')
  async email(@Param('orderId') orderId: string, @Body() body: unknown): Promise<{ ok: true }> {
    const { email } = emailBody.parse(body);
    await this.receipts.emailReceipt(ulidSchema.parse(orderId), email);
    return { ok: true };
  }
}
