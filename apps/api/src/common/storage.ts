import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';

/**
 * Object storage behind an adapter (tech-stack.md: printer/payments/email/
 * storage are all adapters). Dev: MinIO from docker-compose; prod: any
 * S3-compatible provider picked when hosting credentials land.
 */

export interface PresignedUpload {
  /** PUT the raw file body here with the given content type. */
  upload_url: string;
  /** Object key to persist on the owning entity. */
  key: string;
  /** URL clients read the object from. */
  public_url: string;
}

export interface ObjectStorage {
  presignUpload(key: string, contentType: string): Promise<PresignedUpload>;
  publicUrl(key: string): string;
}

@Injectable()
export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBase: string;

  constructor() {
    const endpoint = process.env['S3_ENDPOINT'] ?? 'http://localhost:9000';
    this.bucket = process.env['S3_BUCKET'] ?? 'retailos-dev';
    // MinIO serves objects at <endpoint>/<bucket>/<key>; CDN-fronted prod
    // buckets override via S3_PUBLIC_URL.
    this.publicBase = process.env['S3_PUBLIC_URL'] ?? `${endpoint}/${this.bucket}`;
    this.client = new S3Client({
      endpoint,
      region: process.env['S3_REGION'] ?? 'us-east-1',
      forcePathStyle: true, // MinIO requires path-style addressing
      credentials: {
        accessKeyId: process.env['S3_ACCESS_KEY'] ?? 'retailos',
        secretAccessKey: process.env['S3_SECRET_KEY'] ?? 'retailos-dev',
      },
    });
  }

  async presignUpload(key: string, contentType: string): Promise<PresignedUpload> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: 900 });
    return { upload_url: uploadUrl, key, public_url: this.publicUrl(key) };
  }

  publicUrl(key: string): string {
    return `${this.publicBase}/${key}`;
  }
}

/** DI token: modules depend on the interface, tests inject a fake. */
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');
