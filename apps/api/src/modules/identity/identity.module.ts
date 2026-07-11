import { Module } from '@nestjs/common';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { RolesController, StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({
  controllers: [IdentityController, StaffController, RolesController],
  providers: [IdentityService, StaffService],
  exports: [IdentityService, StaffService],
})
export class IdentityModule {}
