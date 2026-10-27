/**
 * ROK-1901 — the app-entry diet stays on. `app-entry.tsx` loads on every page,
 * so the event routes and the More drawer's on-demand content must reach it
 * only through a dynamic `import()`. A static import from anywhere in the
 * entry's graph would pull them (and their ~58 KB gz) straight back in.
 * `import type` is skipped: it erases at build time.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripComments } from './test/strip-comments';

const here = dirname(fileURLToPath(import.meta.url));
const IMPORT_RE = /^(?:import|export)\s+(?!type\s)(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/gm;

const LAZY_ONLY = [
    'pages/events-page.tsx',
    'pages/event-detail-page.tsx',
    'components/layout/more-drawer-submenus.tsx',
    'components/layout/more-drawer-game-time.tsx',
    'pages/scheduling/GameTimeCheckSheet.tsx',
    'components/features/game-time/phone/PhoneWeekCheckStep.tsx',
    'components/admin/admin-nav-data.tsx',
];

function resolveLocal(fromFile: string, spec: string): string | null {
    if (!spec.startsWith('.')) return null;
    const base = join(dirname(fromFile), spec);
    const hit = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')].find(
        (p) => existsSync(p) && /\.tsx?$/.test(p),
    );
    return hit ?? null;
}

function staticGraph(entry: string): string[] {
    const seen = new Set<string>();
    const walk = (file: string): void => {
        if (seen.has(file)) return;
        seen.add(file);
        for (const m of stripComments(readFileSync(file, 'utf8')).matchAll(IMPORT_RE)) {
            const next = m[1] === undefined ? null : resolveLocal(file, m[1]);
            if (next) walk(next);
        }
    };
    walk(join(here, entry));
    return [...seen].map((f) => relative(here, f).split('\\').join('/'));
}

describe('app-entry lazy boundaries (ROK-1901)', () => {
    const graph = staticGraph('app-entry.tsx');

    it('no lazied module is in the static import graph of app-entry.tsx', () => {
        expect(graph.filter((f) => LAZY_ONLY.includes(f)), 'static import pulls a lazy chunk back into app-entry').toEqual([]);
    });

    it('the walker really reaches the shell (self-check)', () => {
        expect(graph).toContain('app-routes.tsx');
        expect(graph).toContain('components/layout/more-drawer.tsx');
        expect(graph).toContain('components/layout/more-drawer-lazy.tsx');
    });

    it('the walker would catch a static import (self-check)', () => {
        const sample = "import { EventsPage } from './pages/events-page';\nimport type { X } from './pages/event-detail-page';";
        expect([...sample.matchAll(IMPORT_RE)].map((m) => m[1])).toEqual(['./pages/events-page']);
    });
});
