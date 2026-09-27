/**
 * ROK-1630 AC17 — no web/src source may build a URL that carries `token=` next
 * to `API_BASE_URL` or a `location.href` navigation. That is how the session
 * JWT used to leak into query strings (nginx logs, /admin/logs, Referer):
 * `/auth/{discord,steam}/link?token=<access JWT>`. Link initiators now POST a
 * start route and navigate with a single-use `?nonce=`.
 *
 * Comments are stripped FIRST: files that explain the old `?token=` carrier in
 * a comment would otherwise trip the guard, and a guard that reads comments can
 * be satisfied by a comment instead of by the code.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import { stripComments } from '../test/form-primitives-count';

const SRC = resolve(__dirname, '..');
const SINK = /API_BASE_URL|location\.href/;
const TOKEN_PARAM = /[?&#]token=/;
const TEST_FILE = /\.(test|spec)\.tsx?$/;

/**
 * The (trimmed) code lines where a token-bearing URL sits next to an API or
 * navigation sink. Lines, not numbers: stripComments drops block-comment
 * newlines, so a line number would point at the wrong place in the file.
 */
export function tokenUrlLines(src: string): string[] {
    return stripComments(src)
        .split('\n')
        .filter((line) => SINK.test(line) && TOKEN_PARAM.test(line))
        .map((line) => line.trim());
}

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return sourceFiles(full);
        return /\.tsx?$/.test(name) && !TEST_FILE.test(name) ? [full] : [];
    });
}

describe('auth token never built into a URL (ROK-1630 AC17)', () => {
    it('no web/src source builds a token= URL next to API_BASE_URL or location.href', () => {
        const violations = sourceFiles(SRC).flatMap((file) =>
            tokenUrlLines(readFileSync(file, 'utf-8')).map((line) => `${relative(SRC, file)}: ${line}`),
        );
        expect(violations, 'use POST /auth/{provider}/link/start + ?nonce= instead of a token in the URL').toEqual([]);
    });
});

describe('tokenUrlLines — the matcher', () => {
    it('flags the pre-ROK-1630 Discord initiator', () => {
        const src = 'window.location.href = `${API_BASE_URL}/auth/discord/link?token=${encodeURIComponent(token)}`;';
        expect(tokenUrlLines(src)).toEqual([src]);
    });

    it('flags the pre-ROK-1630 Steam URL builder and an appended &token=', () => {
        const src = 'let url = `${API_BASE_URL}/auth/steam/link?token=${t}`;\nlocation.href = base + "&token=" + t;';
        expect(tokenUrlLines(src)).toHaveLength(2);
    });

    it('ignores the same code inside a comment', () => {
        const src = '// window.location.href = `${API_BASE_URL}/x?token=${t}`;\n/* API_BASE_URL?token= */\nconst a = 1;';
        expect(tokenUrlLines(src)).toEqual([]);
    });

    it('ignores the nonce hop and an in-app intent-token route', () => {
        const src = 'window.location.href = `${API_BASE_URL}/auth/steam/link?nonce=${n}`;\nnavigate(`/join?intent=x&token=${t}`);';
        expect(tokenUrlLines(src)).toEqual([]);
    });
});
