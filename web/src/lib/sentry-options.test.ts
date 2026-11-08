import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../test/strip-comments';
import { initialTags } from './sentry-options';

describe('initialTags (ROK-2116)', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('tags app_version with the build-defined __APP_VERSION__', () => {
        vi.stubGlobal('__APP_VERSION__', '9.8.7');
        expect(initialTags().app_version).toBe('9.8.7');
    });

    it('falls back to "unknown" when the build defines no version', () => {
        expect(initialTags().app_version).toBe('unknown');
    });

    // `__APP_VERSION__` is a Vite compile-time `define`: only the bare
    // identifier is replaced, so a `window.` read is always undefined in a
    // built bundle. jsdom aliases window to globalThis, which hides that at
    // runtime — so pin the source shape instead.
    it('reads the Vite define as a bare identifier, never off window', () => {
        const source = stripComments(
            readFileSync(join(process.cwd(), 'src', 'lib', 'sentry-options.ts'), 'utf8'),
        );
        expect(source).not.toMatch(/window[^;\n]*__APP_VERSION__/);
        expect(source).toMatch(/typeof __APP_VERSION__/);
    });
});
