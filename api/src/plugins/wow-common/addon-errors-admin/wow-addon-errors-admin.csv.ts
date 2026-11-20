import type { AddonErrorExportRowDto } from '@raid-ledger/contract';

/**
 * ROK-2099 (S3) — CSV writer for the admin addon-error export (RFC 4180:
 * CRLF rows, a field holding `"`, `,`, CR or LF is quoted with `"` doubled).
 * A text field starting with `=`, `+`, `-`, `@`, TAB or CR is prefixed with
 * `'` so a spreadsheet does not evaluate an uploaded message as a formula.
 */
export const ADDON_ERRORS_CSV_COLUMNS = [
  'id',
  'userId',
  'username',
  'characterName',
  'characterRealm',
  'source',
  'sourceVersion',
  'addon',
  'message',
  'stack',
  'count',
  'session',
  'firstSeenAt',
  'lastSeenAt',
  'recordHash',
  'scrubbedCount',
] as const satisfies readonly (keyof AddonErrorExportRowDto)[];

const FORMULA_LEAD = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/** One CSV cell: null → empty, numbers as-is, text guarded + quoted. */
export function csvCell(value: string | number | null): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  const guarded = FORMULA_LEAD.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(guarded)
    ? `"${guarded.replace(/"/g, '""')}"`
    : guarded;
}

/** Header row + one line per record, CRLF-terminated. */
export function toAddonErrorsCsv(rows: AddonErrorExportRowDto[]): string {
  const lines = [ADDON_ERRORS_CSV_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(ADDON_ERRORS_CSV_COLUMNS.map((c) => csvCell(row[c])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
