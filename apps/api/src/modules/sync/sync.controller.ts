import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { activateDeviceSchema } from './dto';
import { DevicesService } from './devices.service';
import { SyncService } from './sync.service';

/**
 * Device-facing sync surface (offline-sync-strategy.md). /sync/activate is the
 * only unauthenticated route; the rest require the device bearer token.
 */
@ApiTags('sync')
@Controller('sync')
export class SyncController {
  constructor(
    private readonly devices: DevicesService,
    private readonly sync: SyncService,
  ) {}

  @Post('activate')
  @ApiOperation({
    operationId: 'activateDevice',
    summary: 'Exchange a one-time activation code for a device token (shown once)',
  })
  async activate(@Body() body: unknown) {
    const input = activateDeviceSchema.parse(body);
    const result = await this.devices.activate(input.code, input.app_version);
    return {
      device_token: result.deviceToken,
      store_id: result.storeId,
      register_id: result.registerId,
      location_id: result.locationId,
    };
  }

  @Get('bootstrap')
  @ApiOperation({
    operationId: 'syncBootstrap',
    summary: 'Full snapshot for a freshly activated register (device token)',
  })
  async bootstrap(@Req() req: Request) {
    const ctx = await this.devices.authenticate(req.headers.authorization);
    return this.sync.bootstrap(ctx);
  }
}
