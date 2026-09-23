/**
 * ROK-1480 — no internal Linear ticket reference reaches a rendered surface.
 *
 * The audit found ticket ids in copy the user actually reads: seven Admin →
 * Scheduled Jobs descriptions, the Co-Optimus setup instructions and the
 * session-lifetime helper text. A per-component assertion cannot catch the
 * surface nobody remembered, so this reads the SOURCE of every shipped web
 * file instead.
 *
 * Ticket ids in comments and JSDoc are deliberate provenance and stay — this
 * repo uses them everywhere. Comments are therefore stripped BEFORE scanning,
 * quote-aware, so a line like `case 'x': // ROK-1 note` is not a false hit.
 * The repo has been bitten twice (ROK-1314) by a source-scanning guard
 * tripping on its own explanatory prose; the sentence you are reading names
 * the very pattern it forbids and must not fail this test.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Resolved from THIS file, not the cwd — vitest runs from `web/`. */
const WEB_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * `web/src/dev/**` is DEMO_MODE-gated wireframes and design galleries that
 * name their own story on purpose — they are an internal design surface, and
 * nothing in them ships to a user.
 */
const EXCLUDED_DIRS = new Set(['dev']);

const TICKET_REF = /ROK-\d{2,4}/;

/** Every shipped, non-test `.ts`/`.tsx` file under `dir`, recursively. */
function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            return EXCLUDED_DIRS.has(entry) ? [] : sourceFiles(full);
        }
        if (!/\.tsx?$/.test(entry)) return [];
        if (/\.(test|spec)\.tsx?$/.test(entry)) return [];
        return [full];
    });
}

/**
 * Drop block and line comments so the guard never trips on provenance prose.
 * Quote-aware: a `//` inside a string literal is content, not a comment, and
 * a `'` earlier on the line must not hide a real trailing comment.
 */
export function stripComments(source: string): string {
    let out = '';
    let quote: string | null = null;
    let i = 0;
    while (i < source.length) {
        const ch = source[i];
        const next = source[i + 1];
        if (quote) {
            if (ch === '\\') {
                out += ch + (next ?? '');
                i += 2;
                continue;
            }
            if (ch === quote) quote = null;
            // Only a template literal spans lines. Resetting at the newline
            // stops an apostrophe in JSX text ("Don't") from opening a string
            // that swallows every comment after it.
            else if (ch === '\n' && quote !== '`') quote = null;
            out += ch;
            i += 1;
            continue;
        }
        if (ch === "'" || ch === '"' || ch === '`') {
            quote = ch;
            out += ch;
            i += 1;
            continue;
        }
        if (ch === '/' && next === '/') {
            while (i < source.length && source[i] !== '\n') i += 1;
            continue;
        }
        if (ch === '/' && next === '*') {
            i += 2;
            while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
                if (source[i] === '\n') out += '\n';
                i += 1;
            }
            i += 2;
            continue;
        }
        out += ch;
        i += 1;
    }
    return out;
}

describe('user-facing copy sweep (ROK-1480)', () => {
    it('no shipped web source renders an internal ticket reference', () => {
        const offenders = sourceFiles(WEB_SRC)
            .flatMap((file) => {
                const body = stripComments(readFileSync(file, 'utf8'));
                return body
                    .split('\n')
                    .map((line, index) => ({ file, line, index }))
                    .filter(({ line }) => TICKET_REF.test(line));
            })
            .map(
                ({ file, line, index }) =>
                    `${relative(WEB_SRC, file)}:${index + 1}: ${line.trim()}`,
            );

        expect(offenders).toEqual([]);
    });

    it('scans a non-empty set of files (the guard itself is alive)', () => {
        expect(sourceFiles(WEB_SRC).length).toBeGreaterThan(100);
    });

    it('strips comments without swallowing string content', () => {
        expect(stripComments("case 'x': // ROK-1563 note")).not.toMatch(
            TICKET_REF,
        );
        expect(stripComments("const a = 'http://x'; // note")).toContain(
            'http://x',
        );
        expect(stripComments('/* ROK-1 */ const b = 1;')).not.toMatch(
            TICKET_REF,
        );
        expect(
            stripComments("<p>Don't</p>\n/** ROK-1563 note */\n"),
        ).not.toMatch(TICKET_REF);
    });
});
