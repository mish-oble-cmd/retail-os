import { Controller, Get, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { asc } from 'drizzle-orm';
import type { Request } from 'express';
import { requireSession } from '../../common/session';
import { DbService } from '../../db/db.service';
import { taxCategories } from '../../db/schema';

/**
 * Read-only list for pickers (ADM-04 Organization card). The full tax
 * settings editor is ADM-17, later in Phase 1.
 */
@ApiTags('catalog')
@Controller('tax-categories')
export class TaxCategoriesController {
  constructor(private readonly db: DbService) {}

  @Get()
  @ApiOperation({ operationId: 'listTaxCategories', summary: 'Tax categories for pickers' })
  async list(@Req() req: Request) {
    const { storeId } = requireSession(req);
    const rows = await this.db.tenants
      .forStore(storeId)
      .tx((tx) =>
        tx
          .select({ id: taxCategories.id, name: taxCategories.name })
          .from(taxCategories)
          .orderBy(asc(taxCategories.id)),
      );
    return { items: rows };
  }
}
