import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { stripComments } from './wcag-contrast';

/**
 * ROK-1901 (Codex P2): the shared `.btn` classes live in the EAGER stylesheet.
 *
 * `index.css` is imported by `app-entry.tsx`, so it styles every page on first
 * paint. `/join`, `/i/:code`, the invite flow, the roster builder and the
 * profile page all use `btn btn-primary` / `btn-secondary`; when those rules sat
 * in `event-detail-page.css` they left with the lazy event-detail chunk and the
 * buttons rendered unstyled until the prefetch landed (never, under Data Saver).
 * So: the base rules must be in `index.css`, and no other stylesheet — every one
 * of them is page- or component-scoped and may be split into a lazy chunk — may
 * define them.
 */
const SRC = resolve(__dirname, '..');
const SHARED = ['.btn', '.btn-sm', '.btn-primary', '.btn-secondary', '.btn-danger', '.btn-warning'];

/** A selector list that targets `cls` itself (not `.btn-slot`, not a descendant of a scope). */
function definesBase(css: string, cls: string): boolean {
    const escaped = cls.replace(/[.-]/g, (c) => `\\${c}`);
    return new RegExp(`(^|[},])\\s*${escaped}(:[a-z-]+)?\\s*[{,]`, 'm').test(css);
}

const STYLESHEETS = (readdirSync(SRC, { recursive: true }) as string[])
    .map((f) => f.split(sep).join('/'))
    .filter((f) => f.endsWith('.css') && !f.startsWith('dev/'))
    .sort()
    .map((f) => [f, stripComments(readFileSync(join(SRC, f), 'utf-8'))] as const);

describe('shared .btn classes are global (ROK-1901)', () => {
    const indexCss = STYLESHEETS.find(([f]) => f === 'index.css')?.[1] ?? '';

    it.each(SHARED)('index.css defines %s', (cls) => {
        expect(definesBase(indexCss, cls), `${cls} is not defined in the eager index.css`).toBe(true);
    });

    it('no other stylesheet defines a shared .btn class', () => {
        const offenders = STYLESHEETS.filter(([f]) => f !== 'index.css').flatMap(([f, css]) =>
            SHARED.filter((cls) => definesBase(css, cls)).map((cls) => `${f}: ${cls}`),
        );
        expect(offenders, 'a lazily-loaded stylesheet defines a shared .btn class — move it to index.css').toEqual([]);
    });

    it('the scanner reads page stylesheets (self-check)', () => {
        const files = STYLESHEETS.map(([f]) => f);
        expect(files).toContain('pages/event-detail-page.css');
        expect(files).toContain('pages/user-profile-page.css');
        expect(definesBase('.foo{}\n.btn-primary:hover {', '.btn-primary')).toBe(true);
        expect(definesBase('.btn-slot {', '.btn')).toBe(false);
    });
});
