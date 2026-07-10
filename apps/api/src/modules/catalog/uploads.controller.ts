import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { requireSession } from '../../common/session';
import { UploadsService } from './uploads.service';

const presignSchema = z.object({
  content_type: z.string().min(1).max(100),
});

@ApiTags('catalog')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('product-image')
  @ApiOperation({
    operationId: 'presignProductImageUpload',
    summary: 'Presigned PUT for a product image; persist the returned public_url via PATCH /products/{id} images',
  })
  async presignProductImage(@Body() body: unknown, @Req() req: Request) {
    const { storeId, staffId } = requireSession(req);
    return this.uploads.presignProductImage(
      storeId,
      staffId,
      presignSchema.parse(body).content_type,
    );
  }
}
