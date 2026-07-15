/**
 * Minimal RFC 4180 CSV for the FR-2.6 Phase 1 subset — fixed template,
 * create-only. Hand-rolled on purpose: the format is pinned by us, and the
 * full importer (dry-run, upsert, images) arrives in Phase 2 where a library
 * choice can be revisited.
 */

export const IMPORT_HEADER = [
  'name',
  'category',
  'price',
  'sku',
  'barcode',
  'initial_stock',
  'tax_category',
  'option1_name',
  'option1_value',
  'option2_name',
  'option2_value',
  'option3_name',
  'option3_value',
] as const;

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    switch (ch) {
      case '"':
        inQuotes = true;
        break;
      case ',':
        row.push(field);
        field = '';
        break;
      case '\r':
        break; // CRLF handled by the \n branch
      case '\n':
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        break;
      default:
        field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Trailing blank lines are not data.
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function escapeField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeField).join(',')).join('\n') + '\n';
}

/**
 * "2.50" → 250. Exact string math — floats never touch money (CLAUDE.md
 * rule 5). Phase 1 assumes 2-decimal currencies (SGD, PHP).
 */
export function parseMajorToMinor(value: string): number | null {
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const whole = match[1] ?? '0';
  const frac = (match[2] ?? '').padEnd(2, '0');
  return Number(whole) * 100 + Number(frac);
}

export function formatMinorToMajor(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
