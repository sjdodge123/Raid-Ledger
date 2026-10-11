/**
 * ROK-1754 AC: the access token is held in memory only. Outside tests, the
 * old storage key `raid_ledger_token` may appear ONCE — as the purge-only
 * constant in auth-storage-keys.ts. Any other code mention is a reader or a
 * writer that bypasses the in-memory store (B1 left four such strays).
 *
 * Comments are stripped FIRST, so a comment explaining the old key neither
 * trips the guard nor can satisfy it.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import { stripComments } from '../../test/form-primitives-count';

const SRC = resolve(__dirname, '../..');
const KEY = /\braid_ledger_token\b/;
const TEST_FILE = /\.(test|spec)\.tsx?$/;
const ALLOWED = [`lib/api/auth-storage-keys.ts: export const LEGACY_ACCESS_TOKEN_KEY = 'raid_ledger_token';`];

/** Trimmed code lines (comments stripped) that mention the legacy key. */
export function legacyKeyLines(src: string): string[] {
    return stripComments(src).split('\n').filter((l) => KEY.test(l)).map((l) => l.trim());
}

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return sourceFiles(full);
        return /\.tsx?$/.test(name) && !TEST_FILE.test(name) ? [full] : [];
    });
}

describe('ROK-1754 guard: raid_ledger_token only as the legacy-purge constant', () => {
    it('ignores comments but catches code', () => {
        expect(legacyKeyLines(`// raid_ledger_token was here\n/* raid_ledger_token */`)).toEqual([]);
        expect(legacyKeyLines(`const t = localStorage.getItem('raid_ledger_token');`)).toEqual([
            `const t = localStorage.getItem('raid_ledger_token');`,
        ]);
    });

    it('non-test web/src mentions it only in the purge-only constant', () => {
        const hits = sourceFiles(SRC).flatMap((file) =>
            legacyKeyLines(readFileSync(file, 'utf8')).map((line) => `${relative(SRC, file)}: ${line}`),
        );
        expect(hits).toEqual(ALLOWED);
    });
});
