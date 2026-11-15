/**
 * Shared helpers for `gen-ledgerlink-fixtures.ts` and its v2 half
 * (`gen-ledgerlink-fixtures.v2.ts`): the `.json` formatter, the real-decoder
 * error-code probe and the fixture "now" (ROK-1724, ROK-2184).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AddonImportErrorCode } from '@raid-ledger/contract';
import { decodeImportPaste } from '../src/plugins/wow-common/addon-import/addon-import.decoder';
import { AddonImportError } from '../src/plugins/wow-common/addon-import/addon-import.errors';
import { FIXTURE_EXPORTED_AT } from '../src/plugins/wow-common/addon-import/testing/addon-fixture.builder';

/** One hour after the golden export stamp — `pinExportClock`'s default. */
export const FIXTURE_NOW_MS = (FIXTURE_EXPORTED_AT + 3600) * 1000;

/** A file to write, relative to a version's `fixtures/` folder. */
export interface FixtureFile {
  path: string;
  content: string;
}

/** Pretty JSON, but containers 4+ levels deep stay on one line. */
export function fmt(value: unknown, depth = 0): string {
  if (value === null || typeof value !== 'object' || depth >= 4) {
    return JSON.stringify(value);
  }
  const pad = '  '.repeat(depth + 1);
  const end = '  '.repeat(depth);
  const parts = Array.isArray(value)
    ? value.map((v) => pad + fmt(v, depth + 1))
    : Object.entries(value).map(
        ([k, v]) => `${pad}${JSON.stringify(k)}: ${fmt(v, depth + 1)}`,
      );
  const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  return parts.length
    ? `${open}\n${parts.join(',\n')}\n${end}${close}`
    : `${open}${close}`;
}

/** The decoder's error code for `paste`, or null when it decodes. */
export function codeOf(
  paste: string,
  nowMs?: number,
): AddonImportErrorCode | null {
  try {
    decodeImportPaste(paste, nowMs);
    return null;
  } catch (err) {
    if (err instanceof AddonImportError) return err.code;
    throw err;
  }
}

export function writeFixtures(dir: string, files: FixtureFile[]): void {
  for (const f of files) {
    const path = join(dir, f.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, f.content);
  }
}
