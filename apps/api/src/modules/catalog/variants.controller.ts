import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { requireSession } from '../../common/session';
import { ulidSchema, updateVariantSchema } from './dto';
import { ProductsService } from './products.service';

@ApiTags('catalog')
@Controller('variants')
export class VariantsController {
  constructor(private readonly products: ProductsService) {}

  @Get(':id')
  @ApiOperation({ operationId: 'getVariant', summary: 'Variant with barcodes and on-hand' })
  async get(@Param('id') id: string, @Req() req: Request) {
    const { storeId } = requireSession(req);
    return this.products.getVariant(storeId, ulidSchema.parse(id));
  }

  @Patch(':id')
  @ApiOperation({
    operationId: 'updateVariant',
    summary: 'Update variant pricing/SKU/tracking; `barcodes` replaces the whole set',
  })
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const { storeId, staffId } = requireSession(req);
    return this.products.updateVariant(storeId, staffId, ulidSchema.parse(id), updateVariantSchema.parse(body));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'deleteVariant',
    summary: 'Delete a variant with no stock history (409 otherwise — the ledger references it forever)',
  })
  async remove(@Param('id') id: string, @Req() req: Request) {
    const { storeId, staffId } = requireSession(req);
    await this.products.removeVariant(storeId, staffId, ulidSchema.parse(id));
  }
}
