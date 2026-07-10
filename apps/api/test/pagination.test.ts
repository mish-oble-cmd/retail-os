import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { encodeCursor, parsePageRequest, toPage } from '../src/common/pagination';

const ULID_A = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ULID_B = '01BX5ZZKBKACTAV9WEVGEMMVRZ';

describe('parsePageRequest', () => {
  it('defaults limit to 50 with no cursor', () => {
    expect(parsePageRequest({})).toEqual({ limit: 50, after: undefined });
  });

  it('coerces string limits (query params arrive as strings)', () => {
    expect(parsePageRequest({ limit: '10' })).toEqual({ limit: 10, after: undefined });
  });

  it('rejects limits outside 1..100', () => {
    expect(() => parsePageRequest({ limit: 0 })).toThrow(ZodError);
    expect(() => parsePageRequest({ limit: 101 })).toThrow(ZodError);
  });

  it('round-trips an encoded cursor back to the keyset id', () => {
    expect(parsePageRequest({ cursor: encodeCursor(ULID_A) }).after).toBe(ULID_A);
  });

  it('rejects tampered cursors instead of silently resetting to page one', () => {
    expect(() => parsePageRequest({ cursor: 'not-a-cursor' })).toThrow(BadRequestException);
    expect(() =>
      parsePageRequest({ cursor: Buffer.from('DROP TABLE products').toString('base64url') }),
    ).toThrow(BadRequestException);
  });
});

describe('toPage', () => {
  const rows = (...ids: string[]) => ids.map((id) => ({ id }));

  it('returns next_cursor when the over-fetched row exists', () => {
    const page = toPage(rows(ULID_A, ULID_B), 1);
    expect(page.items).toHaveLength(1);
    expect(page.next_cursor).toBe(encodeCursor(ULID_A));
  });

  it('returns null next_cursor on the last page', () => {
    const page = toPage(rows(ULID_A), 1);
    expect(page.items).toHaveLength(1);
    expect(page.next_cursor).toBeNull();
  });

  it('handles an empty result set', () => {
    expect(toPage(rows(), 50)).toEqual({ items: [], next_cursor: null });
  });
});
