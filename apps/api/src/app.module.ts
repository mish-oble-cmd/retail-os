import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { DbModule } from './db/db.module';
import { HealthController } from './health.controller';
import { BillingModule } from './modules/billing/billing.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CustomersModule } from './modules/customers/customers.module';
import { IdentityModule } from './modules/identity/identity.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { LoyaltyModule } from './modules/loyalty/loyalty.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SettingsModule } from './modules/settings/settings.module';
import { SyncModule } from './modules/sync/sync.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';

/** Modular monolith (AD-1): all 12 modules of system-architecture.md, wired. */
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env['LOG_LEVEL'] ?? 'info',
        redact: ['req.headers.cookie', 'req.headers.authorization'],
      },
    }),
    DbModule,
    IdentityModule,
    CatalogModule,
    InventoryModule,
    OrdersModule,
    CustomersModule,
    LoyaltyModule,
    PaymentsModule,
    SyncModule,
    ReportsModule,
    WebhooksModule,
    BillingModule,
    SettingsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
