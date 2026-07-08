import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('platform')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ operationId: 'getHealth', summary: 'Liveness probe (no dependencies touched)' })
  health() {
    return { status: 'ok', service: 'retailos-api', time: new Date().toISOString() };
  }
}
