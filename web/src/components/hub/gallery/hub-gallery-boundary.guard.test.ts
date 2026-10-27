/**
 * ROK-1942 AC8 — the Gallery card, its dialog and every helper beside them are
 * CORE: they import nothing from any plugin folder (only the registration line
 * lives in the Valheim `register.ts`), and say nothing Valheim-specific in code.
 * Comments are stripped first, so prose that names the plugin passes (ROK-1314).
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from '../../../test/strip-comments';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_SRC = resolve(HERE, '../../..');
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"`]([^'"`]+)['"`]/g;

const shipped = readdirSync(HERE).filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f));

function offending(file: string): string[] {
    const src = stripComments(readFileSync(join(HERE, file), 'utf8'));
    const bad = [...src.matchAll(SPECIFIER)].map((m) => m[1] ?? '').filter((spec) => {
        if (!spec.startsWith('.')) return /valheim/i.test(spec);
        const target = relative(WEB_SRC, resolve(HERE, spec)).split('\\').join('/');
        // `plugins/<slug>/…` is a plugin's own code; the loose `plugins/*.ts` host API is allowed.
        return /^plugins\/[^/]+\//.test(target);
    });
    if (/valheim/i.test(src.replace(SPECIFIER, ''))) bad.push('(a "valheim" token in code)');
    return bad;
}

describe('hub Gallery — core boundary (AC8)', () => {
    it('scans the widget and the dialog (not vacuous)', () => {
        expect(shipped).toEqual(expect.arrayContaining(['hub-gallery-widget.tsx', 'hub-gallery-dialog.tsx', 'hub-gallery-viewer.tsx']));
    });

    it.each(shipped)('%s imports nothing from a plugin folder', (file) => {
        expect(offending(file), `${file} reaches into a plugin`).toEqual([]);
    });
});
