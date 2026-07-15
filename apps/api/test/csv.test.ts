import { describe, expect, it } from 'vitest';
import { formatMinorToMajor, parseCsv, parseMajorToMinor, toCsv } from '../src/modules/catalog/csv';

describe('parseCsv', () => {
  it('parses plain rows and trailing newline', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quoted fields with commas, quotes, and newlines', () => {
    expect(parseCsv('name,note\n"Rice, Jasmine","5kg ""premium""\ntwo lines"\n')).toEqual([
      ['name', 'note'],
      ['Rice, Jasmine', '5kg "premium"\ntwo lines'],
    ]);
  });

  it('handles CRLF and skips blank lines', () => {
    expect(parseCsv('a,b\r\n1,2\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('round-trips through toCsv', () => {
    const rows = [
      ['name', 'note'],
      ['Rice, Jasmine', 'has "quotes"'],
      ['Plain', 'ok'],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe('money strings', () => {
  it('parses major units to integer minor units without floats', () => {
    expect(parseMajorToMinor('2.50')).toBe(250);
    expect(parseMajorToMinor('2.5')).toBe(250);
    expect(parseMajorToMinor('0.05')).toBe(5);
    expect(parseMajorToMinor('19')).toBe(1900);
    // The classic float trap: 19.99 * 100 === 1998.9999999999998
    expect(parseMajorToMinor('19.99')).toBe(1999);
  });

  it('rejects garbage', () => {
    for (const bad of ['', 'abc', '1.234', '-5', '1,000', '2.50.1']) {
      expect(parseMajorToMinor(bad)).toBeNull();
    }
  });

  it('formats minor units back to major', () => {
    expect(formatMinorToMajor(250)).toBe('2.50');
    expect(formatMinorToMajor(5)).toBe('0.05');
    expect(formatMinorToMajor(1999)).toBe('19.99');
  });
});
