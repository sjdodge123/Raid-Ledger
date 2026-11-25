/** Shared `hub-admin` text formatting (ROK-1674): aligned columns, no colour. */

/**
 * Pads every column except the last to its widest cell, two spaces apart.
 * Rows may be ragged; trailing padding is never emitted.
 */
export function table(rows: readonly (readonly string[])[]): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  return rows.map((row) =>
    row
      .map((cell, i) =>
        i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0),
      )
      .join('  '),
  );
}

/** `{steam_app_id: 3}` → `'  steam_app_id  3'`, keeping the object's key order. */
export function countLines(
  counts: Readonly<Record<string, number>>,
  indent = '  ',
): string[] {
  const rows = Object.entries(counts).map(([k, n]) => [k, String(n)]);
  return table(rows).map((line) => `${indent}${line}`);
}
