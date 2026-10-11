import { describe, it, expect } from 'vitest';
import { safeHttpUrl } from './safe-http-url';

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
