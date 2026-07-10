import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { requireSession } from '../../common/session';
import {
  createLocationSchema,
  createRegisterSchema,
  ulidSchema,
  updateLocationSchema,
  updateRegisterSchema,
} from './dto';
import { LocationsService } from './locations.service';
import { RegistersService } from './registers.service';

@ApiTags('settings')
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  @ApiOperation({ operationId: 'listLocations', summary: 'All locations' })
  async list(@Req() req: Request) {
    const { storeId } = requireSession(req);
    return { items: await this.locations.list(storeId) };
  }

  @Post()
  @ApiOperation({ operationId: 'createLocation', summary: 'Create a location' })
  async create(@Body() body: unknown, @Req() req: Request) {
    const { storeId, staffId } = requireSession(req);
    return this.locations.create(storeId, staffId, createLocationSchema.parse(body));
  }

  @Patch(':id')
  @ApiOperation({ operationId: 'updateLocation', summary: 'Update or deactivate a location' })
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const { storeId, staffId } = requireSession(req);
    return this.locations.update(storeId, staffId, ulidSchema.parse(id), updateLocationSchema.parse(body));
  }
}

@ApiTags('settings')
@Controller('registers')
export class RegistersController {
  constructor(private readonly registers: RegistersService) {}

  @Get()
  @ApiOperation({
    operationId: 'listRegisters',
    summary: 'All registers with grid layout and pending-activation state',
  })
  async list(@Req() req: Request) {
    const { storeId } = requireSession(req);
    return { items: await this.registers.list(storeId) };
  }

  @Post()
  @ApiOperation({ operationId: 'createRegister', summary: 'Create a register at a location' })
  async create(@Body() body: unknown, @Req() req: Request) {
    const { storeId, staffId } = requireSession(req);
    return this.registers.create(storeId, staffId, createRegisterSchema.parse(body));
  }

  @Patch(':id')
  @ApiOperation({
    operationId: 'updateRegister',
    summary: 'Rename, (de)activate, or save the POS grid layout (ADM-16 designer)',
  })
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const { storeId, staffId } = requireSession(req);
    return this.registers.update(storeId, staffId, ulidSchema.parse(id), updateRegisterSchema.parse(body));
  }

  @Post(':id/activation-codes')
  @ApiOperation({
    operationId: 'issueActivationCode',
    summary:
      'Issue a one-time activation code (8-char, 24 h TTL); shown once, revokes any pending code',
  })
  async issueActivationCode(@Param('id') id: string, @Req() req: Request) {
    const { storeId, staffId } = requireSession(req);
    return this.registers.issueActivationCode(storeId, staffId, ulidSchema.parse(id));
  }

  @Delete(':id/activation-codes')
  @HttpCode(204)
  @ApiOperation({ operationId: 'revokeActivationCode', summary: 'Revoke the pending activation code' })
  async revokeActivationCode(@Param('id') id: string, @Req() req: Request) {
    const { storeId, staffId } = requireSession(req);
    await this.registers.revokeActivationCode(storeId, staffId, ulidSchema.parse(id));
  }
}
