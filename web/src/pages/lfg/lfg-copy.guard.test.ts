/**
 * ROK-1616 AC5 — nothing on the LFG surface still offers a 30/60 minute split.
 *
 * AC5 exists because a rename leaves surfaces behind: the picker moves to three
 * horizons while some panel, dialog or chip keeps saying `Right now · 30 min`.
 * A per-component assertion cannot catch the surface nobody remembered, so this
 * reads the SOURCE of every LFG page and component instead.
 *
 * Comments are stripped BEFORE scanning. The repo has been bitten twice
 * (ROK-1314) by a source-scanning guard tripping on its own explanatory prose —
 * the sentence you are reading names the very strings it forbids.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LFG_COPY } from './lfg-copy';

/** Resolved from THIS file, not the cwd — vitest runs from `web/`. */
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOTS = [HERE, resolve(HERE, '../../components/lfg')];

/** The vocabulary the player must never be offered again. */
const RETIRED_TTL = /30 min|60 min|1 hour|urgencyNow30|urgencyNow60/;

/** Every non-test `.ts`/`.tsx` file under `dir`, recursively. */
function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return sourceFiles(full);
        if (!/\.tsx?$/.test(entry)) return [];
        if (/\.(test|spec)\.tsx?$/.test(entry)) return [];
        return [full];
    });
}

/** Drop block and line comments so a guard never trips on its own prose. */
function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[^'"`\n]*\/\/.*$/gm, '');
}

describe('LFG copy sweep (ROK-1616 AC5)', () => {
    it('names the three horizons and nothing else', () => {
        expect(LFG_COPY.urgencyNow).toBe('Right now');
        expect(LFG_COPY.urgencyTonight).toBe('Tonight');
        expect(LFG_COPY.urgencyWeek).toBe('This week');
    });

    it('no LFG source file still offers a 30 or 60 minute choice', () => {
        const offenders = ROOTS.flatMap(sourceFiles)
            .map((file) => ({
                file,
                body: stripComments(readFileSync(file, 'utf8')),
            }))
            .filter(({ body }) => RETIRED_TTL.test(body))
            .map(({ file }) => file);

        expect(offenders).toEqual([]);
    });

    it('scans a non-empty set of files (the guard itself is alive)', () => {
        expect(ROOTS.flatMap(sourceFiles).length).toBeGreaterThan(10);
    });
});
