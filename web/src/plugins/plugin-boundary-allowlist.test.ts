/**
 * ROK-2366 — `web/plugin-boundary-allowlist.json` freezes today's deep imports
 * into `plugins/<x>/**` from outside `src/plugins/` (lint rule
 * `rl-plugin-boundary/deep-import`, in `eslint-rules/plugin-boundary.mjs`).
 * The rule reports a listed specifier the file no longer imports as stale;
 * this test covers what the rule cannot see: a listed file that was deleted
 * or renamed, or an entry that is malformed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_DIR = `${resolve(__dirname, '../..')}/`;

/**
 * Shrink-only pin: the list's total number of specifiers. When you delete
 * entries, LOWER this to the new total in the same PR. NEVER raise it: a new
 * deep import goes through `plugins/<x>/index.ts` (or `register.ts`) instead.
 * Raising it needs operator sign-off, and the number edit is what review sees.
 */
const MAX_SPECIFIERS = 10;

function readAllowlist(): Record<string, unknown> {
    const parsed: unknown = JSON.parse(readFileSync(`${WEB_DIR}plugin-boundary-allowlist.json`, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('plugin-boundary-allowlist.json must be a JSON object');
    }
    return Object.fromEntries(Object.entries(parsed));
}

describe('plugin-boundary allowlist (ROK-2366, shrink-only)', () => {
    const allowlist = readAllowlist();

    it('lists only files that still exist (delete the entry of a removed file)', () => {
        const missing = Object.keys(allowlist).filter((file) => !existsSync(`${WEB_DIR}${file}`));
        expect(missing).toEqual([]);
    });

    it('holds exactly MAX_SPECIFIERS entries: after deleting some, LOWER the pin; never raise it', () => {
        const total = Object.values(allowlist).reduce<number>((n, s) => n + (Array.isArray(s) ? s.length : 0), 0);
        expect(total, `allowlist total ${total} ≠ MAX_SPECIFIERS ${MAX_SPECIFIERS}: lower the pin after deleting entries; never raise it`).toBe(MAX_SPECIFIERS);
    });

    it('lists only lint-checked files: not dev pages or tests', () => {
        const outOfScope = Object.keys(allowlist).filter((file) => /^src\/(dev|test)\/|\.(test|spec)\.tsx?$/.test(file));
        expect(outOfScope).toEqual([]);
    });

    it('keeps the file keys sorted, so diffs stay stable', () => {
        const keys = Object.keys(allowlist);
        expect(keys).toEqual([...keys].sort());
    });

    it('keeps every entry a non-empty, sorted, unique list of specifiers', () => {
        const bad = Object.entries(allowlist)
            .filter(([, specs]) => {
                if (!Array.isArray(specs) || specs.length === 0) return true;
                const strings = specs.filter((s): s is string => typeof s === 'string');
                const sorted = [...new Set(strings)].sort();
                return strings.length !== specs.length || sorted.join('\n') !== strings.join('\n');
            })
            .map(([file]) => file);
        expect(bad).toEqual([]);
    });
});
