import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { requireSession } from '../../common/session';
import { CategoriesService } from './categories.service';
import { createCategorySchema, ulidSchema, updateCategorySchema } from './dto';

@ApiTags('catalog')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiOperation({ operationId: 'listCategories', summary: 'All categories, sort-ordered (client builds the tree)' })
  async list(@Req() req: Request) {
    const { storeId } = requireSession(req);
    return { items: await this.categories.list(storeId) };
  }

  @Post()
  @ApiOperation({ operationId: 'createCategory', summary: 'Create a category' })
  async create(@Body() body: unknown, @Req() req: Request) {
    const { storeId, staffId } = requireSession(req);
    return this.categories.create(storeId, staffId, createCategorySchema.parse(body));
  }

  @Patch(':id')
  @ApiOperation({ operationId: 'updateCategory', summary: 'Rename, re-sort, or re-parent a category' })
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const { storeId, staffId } = requireSession(req);
    return this.categories.update(
      storeId,
      staffId,
      ulidSchema.parse(id),
      updateCategorySchema.parse(body),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ operationId: 'deleteCategory', summary: 'Delete an empty category' })
  async remove(@Param('id') id: string, @Req() req: Request) {
    const { storeId, staffId } = requireSession(req);
    await this.categories.remove(storeId, staffId, ulidSchema.parse(id));
  }
}
