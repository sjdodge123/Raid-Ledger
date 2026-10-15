/**
 * ROK-1774 — core never imports the Pelican plugin's code.
 *
 * The calendar draws Pelican's server schedule through the generic host API
 * (`web/src/plugins/calendar-layer.ts`, `PluginHandle.registerCalendarLayer`).
 * This guard reads the SOURCE of every shipped file under `components/`,
 * `pages/` and `plugins/calendar-layer*.ts` and fails on any import, re-export
 * or dynamic import whose specifier has a `pelican` path segment.
 *
 * Comments are stripped first (`stripComments`), so prose that mentions the
 * plugin's folder — like this header — passes (the ROK-1314 trap).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './form-primitives-count';

/** Resolved from THIS file, not the cwd — vitest runs from `web/`. */
const WEB_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCANNED_ROOTS = ['components', 'pages'];

/** `from '…'`, `import '…'`, `import('…')` and `require('…')` specifiers. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"`]([^'"`]+)['"`]/g;

function isShippedSource(entry: string): boolean {
    return /\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry);
}

/** Every shipped, non-test `.ts`/`.tsx` file under `dir`, recursively. */
function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return sourceFiles(full);
        return isShippedSource(entry) ? [full] : [];
    });
}

const HOST_API_PREFIXES = ['calendar-layer', 'game-server-status'];

/** The host API files themselves: `plugins/calendar-layer*.ts(x)` and `plugins/game-server-status*.ts(x)` (ROK-1776). */
function hostApiFiles(): string[] {
    const dir = join(WEB_SRC, 'plugins');
    return readdirSync(dir)
        .filter((entry) => HOST_API_PREFIXES.some((p) => entry.startsWith(p)) && isShippedSource(entry))
        .map((entry) => join(dir, entry));
}

export function importsPelican(source: string): boolean {
    const code = stripComments(source);
    return [...code.matchAll(SPECIFIER)].some((m) => (m[1] ?? '').split('/').includes('pelican'));
}

function offendingFiles(): string[] {
    return [...SCANNED_ROOTS.flatMap((root) => sourceFiles(join(WEB_SRC, root))), ...hostApiFiles()]
        .filter((file) => importsPelican(readFileSync(file, 'utf8')))
        .map((file) => relative(WEB_SRC, file));
}

describe('Pelican core boundary guard (ROK-1774)', () => {
    it('strips comments before scanning: prose passes, imports fail', () => {
        expect(importsPelican("// see plugins/pelican/register.ts\n/* from '../plugins/pelican' */ const a = 1;")).toBe(false);
        expect(importsPelican("import { x } from '../../plugins/pelican/calendar/use-items';")).toBe(true);
        expect(importsPelican("export * from './pelican';")).toBe(true);
        expect(importsPelican("import './pelican/register';")).toBe(true);
        expect(importsPelican("const m = await import('../plugins/pelican/hooks');")).toBe(true);
        expect(importsPelican("import { x } from './pelican-servers.helpers';")).toBe(false);
        expect(importsPelican("const label = 'pelican';")).toBe(false);
    });

    it('the host API files are part of the scan', () => {
        expect(hostApiFiles().map((file) => relative(WEB_SRC, file))).toContain('plugins/calendar-layer.ts');
        expect(hostApiFiles().map((file) => relative(WEB_SRC, file))).toContain('plugins/game-server-status.ts');
    });

    it('no core component, page or host API file imports Pelican plugin code', () => {
        const offenders = offendingFiles();
        expect(
            offenders,
            'Core must reach Pelican only through the calendar layer host API (plugins/calendar-layer.ts) '
                + `or a plugin slot. Offending files: ${offenders.join(', ')}`,
        ).toEqual([]);
    });
});
