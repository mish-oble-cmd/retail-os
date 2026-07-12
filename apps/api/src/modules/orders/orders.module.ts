import { Module } from '@nestjs/common';
import { MailerService } from '../../common/mailer';
import { ReceiptController } from './receipt.controller';
import { ReceiptService } from './receipt.service';

/**
 * orders module. Owns the public web-receipt surface (POS-05 QR + email);
 * order writes still arrive through the sync module's fact ingest. Boundaries
 * per monorepo-structure.md rule 2: import this module's exported services only.
 */
@Module({
  controllers: [ReceiptController],
  providers: [ReceiptService, MailerService],
  exports: [ReceiptService],
})
export class OrdersModule {}
