import { Body, Controller, Patch, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { requireSession } from '../../common/session';
import { updateStoreSchema } from './dto';
import { StoreService } from './store.service';

@ApiTags('settings')
@Controller('settings/store')
export class StoreController {
  constructor(private readonly store: StoreService) {}

  @Patch()
  @ApiOperation({
    operationId: 'updateStore',
    summary: 'Update the store profile (name, currency, timezone, tax mode)',
  })
  async update(@Body() body: unknown, @Req() req: Request) {
    const { storeId } = requireSession(req);
    return this.store.update(storeId, updateStoreSchema.parse(body));
  }
}
