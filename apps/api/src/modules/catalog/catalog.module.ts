import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { VariantsController } from './variants.controller';

/**
 * catalog module (FR-2, Phase 1/1A). Boundaries per monorepo-structure.md
 * rule 2: other modules may only import this module's exported services,
 * never its internals or tables.
 */
@Module({
  controllers: [CategoriesController, ProductsController, VariantsController],
  providers: [CategoriesService, ProductsService],
  exports: [CategoriesService, ProductsService],
})
export class CatalogModule {}
