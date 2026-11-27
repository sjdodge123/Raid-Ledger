/**
 * ROK-2366 — `web/plugin-boundary-allowlist.json` freezes today's deep imports
 * into `plugins/<x>/**` from outside `src/plugins/` (lint rule
 * `rl-plugin-boundary/deep-import`, in `eslint-rules/plugin-boundary.mjs`).
 * The rule reports a listed specifier the file no longer imports as stale;
 * this test covers what the rule cannot see: a listed file that was deleted
 * or renamed, or an entry that is malformed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB_DIR = fileURLToPath(new URL('../../', import.meta.url));

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

    it('lists only lint-checked files: not plugins, dev pages or tests', () => {
        const outOfScope = Object.keys(allowlist).filter((file) =>
            /^src\/(plugins|dev|test)\/|\.(test|spec)\.tsx?$/.test(file),
        );
        expect(outOfScope).toEqual([]);
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
