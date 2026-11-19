import { describe, expect, it } from 'vitest';
import { cssUrl, getGameTimeBlockStyle } from './game-colors';

describe('cssUrl', () => {
    it('wraps a normal URL in a double-quoted url() token unchanged', () => {
        expect(cssUrl('https://images.igdb.com/igdb/image/upload/t_cover_big/co1abc.jpg')).toBe(
            'url("https://images.igdb.com/igdb/image/upload/t_cover_big/co1abc.jpg")',
        );
    });

    it('keeps a ")" inside the quoted string so it cannot close the token', () => {
        expect(cssUrl('https://x.test/a), url(https://evil.test/b')).toBe(
            'url("https://x.test/a), url(https://evil.test/b")',
        );
    });

    it('escapes a double quote so it cannot end the string early', () => {
        expect(cssUrl('https://x.test/a"); color: red; ("')).toBe(
            'url("https://x.test/a\\"); color: red; (\\"")',
        );
    });

    it('escapes a backslash before escaping quotes', () => {
        expect(cssUrl('a\\"b')).toBe('url("a\\\\\\"b")');
    });

    it('keeps spaces inside the quoted string', () => {
        expect(cssUrl('https://x.test/my cover.jpg')).toBe('url("https://x.test/my cover.jpg")');
    });

    it('escapes newlines as CSS \\a escapes so the string stays on one line', () => {
        const out = cssUrl('https://x.test/a\nb\r\nc');
        expect(out).toBe('url("https://x.test/a\\a b\\a c")');
        expect(out).not.toMatch(/[\r\n]/);
    });
});

describe('getGameTimeBlockStyle', () => {
    it('layers the quoted cover URL under the gradient', () => {
        const style = getGameTimeBlockStyle(undefined, 'https://x.test/c.jpg');
        expect(style.backgroundImage).toMatch(/, url\("https:\/\/x\.test\/c\.jpg"\)$/);
    });
});
