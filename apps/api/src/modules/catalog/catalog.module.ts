import { Module } from '@nestjs/common';
import { OBJECT_STORAGE, S3ObjectStorage } from '../../common/storage';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { ProductImportService } from './product-import.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { VariantsController } from './variants.controller';

/**
 * catalog module (FR-2, Phase 1/1A). Boundaries per monorepo-structure.md
 * rule 2: other modules may only import this module's exported services,
 * never its internals or tables.
 */
@Module({
  controllers: [CategoriesController, ProductsController, VariantsController, UploadsController],
  providers: [
    CategoriesService,
    ProductsService,
    ProductImportService,
    UploadsService,
    { provide: OBJECT_STORAGE, useClass: S3ObjectStorage },
  ],
  exports: [CategoriesService, ProductsService],
})
export class CatalogModule {}
