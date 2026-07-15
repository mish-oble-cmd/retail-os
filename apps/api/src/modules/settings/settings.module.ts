import { Module } from '@nestjs/common';
import { LocationsService } from './locations.service';
import { RegistersService } from './registers.service';
import { LocationsController, RegistersController } from './settings.controller';
import { StoreController } from './store.controller';
import { StoreService } from './store.service';

/**
 * settings module (FR-10.2, Phase 1/1A: locations, registers, activation
 * codes). Boundaries per monorepo-structure.md rule 2: other modules may only
 * import this module's exported services, never its internals or tables.
 */
@Module({
  controllers: [LocationsController, RegistersController, StoreController],
  providers: [LocationsService, RegistersService, StoreService],
  exports: [LocationsService, RegistersService, StoreService],
})
export class SettingsModule {}
