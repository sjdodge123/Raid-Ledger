/**
 * B66 / TDB:1988 — the shared literal-aware comment stripper (web twin). Each
 * "keeps" case is one the old per-guard regex strippers got wrong: they read a
 * comment marker inside a literal as a real comment and blanked the code after
 * it, so a forbidden token placed there passed the guard.
 */
import { describe, it, expect } from 'vitest';
import { stripComments } from './strip-comments';

/** The naive stripper most guards carried before B66 (the regression target). */
function naiveStrip(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const TOKEN = 'FORBIDDEN_TOKEN';

describe('stripComments — literals are kept whole', () => {
    it.each([
        ['a // inside a single-quoted string', `const u = 'a//b'; ${TOKEN}`],
        ['a URL inside a double-quoted string', `const u = "x//y"; ${TOKEN}`],
        ['an escaped slash pair in a regex literal', `const re = /^https?:\\/\\//; ${TOKEN}`],
        ['a regex literal returned by an arrow (B66 m3)', `const isUrl = (s) => /^https?:\\/\\//.test(s); ${TOKEN}`],
        ['// inside a template literal', `const t = \`a // b\`; ${TOKEN}`],
        ['// and ${} inside a template literal', `const t = \`\${x} // \${y}\`; ${TOKEN}`],
        ['/* inside a string', `const s = '/*'; ${TOKEN}; const e = '*/';`],
        ['an escaped quote inside a string', `const s = 'it\\'s // x'; ${TOKEN}`],
        ['a nested quote of the other kind', `const s = "it's // x"; ${TOKEN}`],
    ])('keeps code after %s', (_label, source) => {
        expect(stripComments(source)).toContain(TOKEN);
    });

    it('the pre-B66 naive regex hid the token after a // in a string (the hole)', () => {
        const source = `const u = 'a//b'; ${TOKEN}`;
        expect(naiveStrip(source)).not.toContain(TOKEN);
        expect(stripComments(source)).toContain(TOKEN);
    });

    it('keeps a JSX attribute URL and a template literal whole', () => {
        expect(stripComments('<a href="http://x">x</a>')).toBe('<a href="http://x">x</a>');
        expect(stripComments('const t = `a // b`;')).toBe('const t = `a // b`;');
    });
});

describe('stripComments — comments are blanked', () => {
    it('strips a trailing line comment only, not division before it', () => {
        expect(stripComments('a / b // c')).toBe('a / b     ');
    });

    it('a /* inside a line comment opens no block', () => {
        const out = stripComments(`// see /* not a block\n${TOKEN}\n`);
        expect(out.split('\n')[1]).toBe(TOKEN);
        expect(out).not.toContain('see');
    });

    it('an apostrophe in JSX text does not shield a following comment', () => {
        const out = stripComments("<p>Don't</p>\n/** ROK-1563 note */\n");
        expect(out).toContain("<p>Don't</p>");
        expect(out).not.toContain('ROK-1563');
    });

    it('blanks a multi-line block comment to the same length and line count', () => {
        const source = `a /* one\n two "x" */ ${TOKEN}`;
        const out = stripComments(source);
        expect(out).toHaveLength(source.length);
        expect(out.split('\n')).toHaveLength(2);
        expect(out).not.toContain('one');
        expect(out.indexOf(TOKEN)).toBe(source.indexOf(TOKEN));
    });

    it('keeps a bare URL in JSX text — a :// is never a comment (B66 M1)', () => {
        const source = `<p>See https://discord.com/x ${TOKEN}</p>`;
        expect(stripComments(source)).toBe(source);
    });

    it('still blanks a real comment that holds a URL', () => {
        expect(stripComments(`a; // see https://x.dev/${TOKEN}`)).toBe('a;' + ' '.repeat(22 + TOKEN.length));
    });

    it('blanks a JSX {/* x */} comment and keeps the braces', () => {
        expect(stripComments('{/* x */}<div />')).toBe('{       }<div />');
    });
});
