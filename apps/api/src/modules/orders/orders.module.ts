import { Module } from '@nestjs/common';
import { MailerService } from '../../common/mailer';
import { ReceiptController } from './receipt.controller';
import { ReceiptService } from './receipt.service';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';

/**
 * orders module. Owns the public web-receipt surface (POS-05 QR + email);
 * order writes still arrive through the sync module's fact ingest. Boundaries
 * per monorepo-structure.md rule 2: import this module's exported services only.
 */
@Module({
  controllers: [ReceiptController, ShiftsController],
  providers: [ReceiptService, MailerService, ShiftsService],
  exports: [ReceiptService, ShiftsService],
})
export class OrdersModule {}
