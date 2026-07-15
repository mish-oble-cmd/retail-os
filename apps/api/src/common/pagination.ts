import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/**
 * Cursor pagination (api-design.md §Conventions): `?limit=50&cursor=...` →
 * `next_cursor`. Keyset on the ULID primary key (lexically time-ordered), so
 * pages are stable under concurrent inserts — no OFFSET drift. The cursor is
 * base64url-wrapped so clients treat it as opaque.
 */

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

export interface PageRequest {
  limit: number;
  /** Decoded keyset position (exclusive) — `undefined` on the first page. */
  after?: string;
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export function encodeCursor(lastId: string): string {
  return Buffer.from(lastId, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): string {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  // ULID alphabet check doubles as tamper detection: a mangled cursor fails
  // loudly instead of silently returning page one.
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(decoded)) {
    throw new BadRequestException('Invalid cursor');
  }
  return decoded;
}

export function parsePageRequest(query: unknown): PageRequest {
  const parsed = paginationQuerySchema.parse(query);
  return {
    limit: parsed.limit,
    after: parsed.cursor === undefined ? undefined : decodeCursor(parsed.cursor),
  };
}

/**
 * Turn `limit + 1` fetched rows into a page: callers over-fetch by one row to
 * learn whether a next page exists without a COUNT query.
 */
export function toPage<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items,
    next_cursor: rows.length > limit && last ? encodeCursor(last.id) : null,
  };
}
