/**
 * ROK-1483 D15 / AC4 / AC9 — read-only is STRUCTURAL, not conventional.
 *
 * A convention is not a guard: the next agent adding a "quick reply" box to the
 * Discord viewer would pass review. This test scans the whole folder's source
 * text so that any write affordance — a mutation hook, a form control, a
 * non-GET verb, a raw-HTML escape hatch — fails the build instead.
 *
 * TWO self-reference traps are handled deliberately:
 *   1. Comments naming the forbidden tokens would trip the guard, so comments
 *      are stripped BEFORE matching (this has bitten ROK-1314 twice).
 *   2. The forbidden list itself would match, so every entry is ASSEMBLED FROM
 *      FRAGMENTS at runtime and no entry appears verbatim in this file. Do not
 *      "tidy" the concatenations back into whole literals.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Resolved from `process.cwd()` (vitest runs from `web/`) rather than
 * `import.meta.url`: under the jsdom environment `import.meta.url` is not a
 * `file:` URL and `fileURLToPath` throws.
 */
const DISCORD_DIR = join(process.cwd(), 'src', 'components', 'discord');

/** Every `.ts` / `.tsx` under the Discord component folder, recursively. */
function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...sourceFiles(full));
        else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
}

/**
 * Removes block and line comments. The `[^:]` guard keeps `https://…` inside
 * string literals intact, so stripping cannot corrupt the code being scanned.
 */
function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Assembled from fragments so this list never matches itself. */
const FORBIDDEN: string[] = [
    'use' + 'Mutation',
    'dangerously' + 'SetInnerHTML',
    '<' + 'form',
    '<' + 'input',
    '<' + 'textarea',
    'content' + 'Editable',
    "'" + 'P' + 'OST' + "'",
    "'" + 'P' + 'UT' + "'",
    "'" + 'PAT' + 'CH' + "'",
    "'" + 'DEL' + 'ETE' + "'",
];

/**
 * A colour written literally, in every form this codebase could produce:
 * `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, and Tailwind's arbitrary-value
 * bracket opener.
 *
 * Deliberately NOT a bare `#`: the tokenizer legitimately builds channel
 * mentions as `#name`, so a bare-hash rule would fail on correct code. The
 * bracket needle is assembled from fragments and the hex needle is a regex
 * whose own source cannot match it, so this file never trips itself (trap 2
 * in the docblock above).
 */
const HEX_LITERAL =
    /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![0-9a-zA-Z])/;
const ARBITRARY_VALUE = '[' + '#';

/**
 * Every hard-coded colour in a file, scanned over the WHOLE comment-stripped
 * source rather than over `className=` sites only.
 *
 * A `className=` scan sees `className={AVATAR_CLASS}` as an identifier and
 * never reads the constant, and this folder hoists class strings twice
 * (`AVATAR_CLASS` in `ThreadMessageRow.tsx`, `LINK_CLASS` in `DiscordText.tsx`)
 * — so a hoisted `text-[#fff]` used to pass the guard. Scanning the whole
 * source is a strict superset and has no hoisting blind spot.
 */
function hexLiterals(source: string): string[] {
    const out: string[] = [];
    for (const line of source.split('\n')) {
        const hex = HEX_LITERAL.exec(line);
        if (hex !== null) out.push(hex[0]);
        else if (line.includes(ARBITRARY_VALUE)) out.push(line.trim());
    }
    return out;
}

const FILES = sourceFiles(DISCORD_DIR);

describe('web/src/components/discord is structurally read-only (AC4)', () => {
    it('scans a non-empty set of files', () => {
        expect(
            FILES.length,
            'the guard found no source files — it would pass vacuously',
        ).toBeGreaterThanOrEqual(4);
    });

    it.each(FILES)('%s contains no write affordance', (file) => {
        const source = stripComments(readFileSync(file, 'utf8'));
        for (const token of FORBIDDEN) {
            expect(
                source.includes(token),
                `${file} contains the forbidden token ${token} — this folder is read-only (D15)`,
            ).toBe(false);
        }
    });
});

describe('web/src/components/discord uses theme tokens only (AC9)', () => {
    it.each(FILES)('%s uses no literal hex colour anywhere', (file) => {
        const source = stripComments(readFileSync(file, 'utf8'));
        expect(
            hexLiterals(source),
            `${file} hard-codes a colour — AC9 allows theme tokens only`,
        ).toEqual([]);
    });
});
