import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { parsePageRequest } from '../../common/pagination';
import { requireSession } from '../../common/session';
import {
  createProductSchema,
  createVariantSchema,
  listProductsQuerySchema,
  ulidSchema,
  updateProductSchema,
} from './dto';
import { ProductsService } from './products.service';

@ApiTags('catalog')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @ApiOperation({
    operationId: 'listProducts',
    summary:
      'Paginated products with variant/stock rollups; search matches name, SKU, or exact barcode. Archived products appear only with status=archived.',
  })
  async list(@Query() query: Record<string, unknown>, @Req() req: Request) {
    const { storeId } = requireSession(req);
    const parsed = listProductsQuerySchema.parse(query);
    return this.products.list(storeId, parsed, parsePageRequest(query));
  }

  @Post()
  @ApiOperation({
    operationId: 'createProduct',
    summary: 'Create a product with its options matrix, variants, barcodes, and opening stock',
  })
  async create(@Body() body: unknown, @Req() req: Request) {
    const { storeId, staffId } = requireSession(req);
    return this.products.create(storeId, staffId, createProductSchema.parse(body));
  }

  @Get(':id')
  @ApiOperation({ operationId: 'getProduct', summary: 'Product with variants, barcodes, and on-hand' })
  async get(@Param('id') id: string, @Req() req: Request) {
    const { storeId } = requireSession(req);
    return this.products.get(storeId, ulidSchema.parse(id));
  }

  @Patch(':id')
  @ApiOperation({ operationId: 'updateProduct', summary: 'Update product-level fields (variants via /variants)' })
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const { storeId, staffId } = requireSession(req);
    return this.products.update(storeId, staffId, ulidSchema.parse(id), updateProductSchema.parse(body));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'archiveProduct',
    summary: 'Archive a product (soft delete — sale history references variants forever)',
  })
  async archive(@Param('id') id: string, @Req() req: Request) {
    const { storeId, staffId } = requireSession(req);
    await this.products.archive(storeId, staffId, ulidSchema.parse(id));
  }

  @Post(':id/variants')
  @ApiOperation({ operationId: 'addVariant', summary: 'Add a variant to an existing product' })
  async addVariant(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const { storeId, staffId } = requireSession(req);
    return this.products.addVariant(storeId, staffId, ulidSchema.parse(id), createVariantSchema.parse(body));
  }
}
