import { describe, it, expect } from 'vitest';
import { isHttpUrl, safeHttpUrl } from './safe-http-url';

describe('safeHttpUrl (ROK-1757)', () => {
    it.each([
        'http://example.com/a',
        'https://worldofwarcraft.blizzard.com/en-us/character/us/realm/name',
    ])('passes %s through unchanged', (url) => {
        expect(safeHttpUrl(url)).toBe(url);
    });

    it.each([
        ['data:', 'data:text/html,<script>alert(1)</script>'],
        ['javascript:', 'javascript:alert(1)'],
        ['vbscript:', 'vbscript:msgbox(1)'],
        ['relative path', '/events/1'],
        ['protocol-relative', '//evil.example/x'],
        ['empty', ''],
        ['null', null],
        ['undefined', undefined],
    ])('rejects %s', (_label, raw) => {
        expect(safeHttpUrl(raw)).toBeUndefined();
    });
});

describe('isHttpUrl — the shared boolean allow-list', () => {
    it.each(['http://example.com/a', 'https://example.com/b?c=1'])('accepts %s', (url) => {
        expect(isHttpUrl(url)).toBe(true);
    });

    it.each([
        ['javascript:', 'javascript:alert(1)'],
        ['data:', 'data:text/html,<script>alert(1)</script>'],
        ['vbscript:', 'vbscript:msgbox(1)'],
        ['relative path', '/events/1'],
        ['malformed', 'http//missing-colon'],
        ['empty', ''],
        ['null', null],
    ])('rejects %s', (_label, raw) => {
        expect(isHttpUrl(raw)).toBe(false);
    });
});
