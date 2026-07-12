import { Controller, Get, Param, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { requireSession } from '../../common/session';
import { ShiftsService } from './shifts.service';

/** Read-only shifts + Z-report for Admin (1D, FR-6.2). Writes arrive via sync facts. */
@ApiTags('shifts')
@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Get()
  @ApiOperation({ operationId: 'listShifts', summary: 'Shifts newest-first with over/short + gross' })
  async list(@Req() req: Request) {
    const { storeId } = requireSession(req);
    return { items: await this.shiftsService.list(storeId) };
  }

  @Get(':id')
  @ApiOperation({ operationId: 'getShift', summary: 'Shift detail with Z snapshot + cash movements' })
  async get(@Param('id') id: string, @Req() req: Request) {
    const { storeId } = requireSession(req);
    return this.shiftsService.get(storeId, id);
  }
}
