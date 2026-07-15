import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ulid } from 'ulid';
import { assertPermission } from '../../common/permissions';
import { OBJECT_STORAGE, type ObjectStorage, type PresignedUpload } from '../../common/storage';
import { DbService } from '../../db/db.service';

/** MIME → extension whitelist; anything else is refused before touching storage. */
const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@Injectable()
export class UploadsService {
  constructor(
    private readonly db: DbService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /**
   * Client flow (ADM-04): presign → PUT file → PATCH product images with the
   * returned public_url. Objects are keyed under the store so tenants can
   * never collide.
   */
  async presignProductImage(
    storeId: string,
    staffId: string,
    contentType: string,
  ): Promise<PresignedUpload> {
    const extension = IMAGE_TYPES[contentType];
    if (!extension) {
      throw new BadRequestException(
        `Unsupported image type "${contentType}" — use one of: ${Object.keys(IMAGE_TYPES).join(', ')}`,
      );
    }
    await this.db.tenants
      .forStore(storeId)
      .tx((tx) => assertPermission(tx, staffId, 'catalog_edit'));
    return this.storage.presignUpload(
      `stores/${storeId}/products/${ulid()}.${extension}`,
      contentType,
    );
  }
}
