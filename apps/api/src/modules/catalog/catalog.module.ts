import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';

/**
 * catalog module (FR-2, Phase 1/1A). Boundaries per monorepo-structure.md
 * rule 2: other modules may only import this module's exported services,
 * never its internals or tables.
 */
@Module({
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CatalogModule {}
