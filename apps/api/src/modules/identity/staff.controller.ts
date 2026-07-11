import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { requireSession } from '../../common/session';
import { createStaffSchema, setPinSchema, ulidSchema, updateStaffSchema } from './dto';
import { StaffService } from './staff.service';

/** 1F staff CRUD + PIN set (ADM-15 Phase-1 subset). Owner-gated in the service. */
@ApiTags('staff')
@Controller('staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get()
  @ApiOperation({ operationId: 'listStaff', summary: 'All staff with role + PIN status' })
  async list(@Req() req: Request) {
    const { storeId, staffId } = requireSession(req);
    return { items: await this.staffService.list(storeId, staffId) };
  }

  @Post()
  @ApiOperation({ operationId: 'createStaff', summary: 'Add a staff member' })
  async create(@Body() body: unknown, @Req() req: Request) {
    const { storeId, staffId } = requireSession(req);
    return this.staffService.create(storeId, staffId, createStaffSchema.parse(body));
  }

  @Patch(':id')
  @ApiOperation({ operationId: 'updateStaff', summary: 'Rename, change role, or (de)activate' })
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const { storeId, staffId } = requireSession(req);
    return this.staffService.update(storeId, staffId, ulidSchema.parse(id), updateStaffSchema.parse(body));
  }

  @Post(':id/pin')
  @ApiOperation({ operationId: 'setStaffPin', summary: 'Set or reset a register PIN' })
  async setPin(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const { storeId, staffId } = requireSession(req);
    return this.staffService.setPin(storeId, staffId, ulidSchema.parse(id), setPinSchema.parse(body).pin);
  }
}

@ApiTags('staff')
@Controller('roles')
export class RolesController {
  constructor(private readonly staffService: StaffService) {}

  @Get()
  @ApiOperation({ operationId: 'listRoles', summary: 'Fixed Phase 1 roles (Owner, Cashier)' })
  async list(@Req() req: Request) {
    const { storeId } = requireSession(req);
    return { items: await this.staffService.listRoles(storeId) };
  }
}
