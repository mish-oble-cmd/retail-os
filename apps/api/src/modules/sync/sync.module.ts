import { Module } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { SyncController } from './sync.controller';

/**
 * sync module (1B): device activation/trust + bootstrap/changes/batches.
 * Boundaries per monorepo-structure.md rule 2: other modules may only import
 * this module's exported services, never its internals or tables.
 */
@Module({
  controllers: [SyncController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class SyncModule {}
