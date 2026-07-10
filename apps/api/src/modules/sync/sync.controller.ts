import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { activateDeviceSchema } from './dto';
import { DevicesService } from './devices.service';

/**
 * Device-facing sync surface (offline-sync-strategy.md). /sync/activate is the
 * only unauthenticated route; the rest require the device bearer token.
 */
@ApiTags('sync')
@Controller('sync')
export class SyncController {
  constructor(private readonly devices: DevicesService) {}

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
}
