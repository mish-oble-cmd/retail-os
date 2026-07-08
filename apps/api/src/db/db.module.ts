import { Global, Module } from '@nestjs/common';
import { DbService } from './db.service';

/** Global: every module gets the same pool + tenancy wrapper. */
@Global()
@Module({
  providers: [DbService],
  exports: [DbService],
})
export class DbModule {}
