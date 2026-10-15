import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SystemStatusDto } from '@raid-ledger/contract';
import { bootstrap, renderBootFailure, statusWithin, type BootSteps } from './bootstrap';
import { stripComments } from './test/strip-comments';

/**
 * ROK-1779 (Codex r6): the telemetry decision and Sentry init happen BEFORE
 * the app's modules are imported, and a broken status fetch never blocks the
 * mount. main.test.tsx drives the same order through main.tsx itself.
 */
const status = (telemetryEnabled?: boolean) =>
    ({ ...(telemetryEnabled === undefined ? {} : { telemetryEnabled }) }) as SystemStatusDto;

function recordingSteps(load: BootSteps['loadStatus'], appFails?: Error) {
    const order: string[] = [];
    const mountApp = vi.fn(() => { order.push('mount'); });
    const steps: BootSteps = {
        loadStatus: (signal) => { order.push('status'); return load(signal); },
        initSentry: vi.fn((on: boolean | undefined) => { order.push(`init:${String(on)}`); return on === true; }),
        loadApp: vi.fn(() => {
            order.push('import-app');
            return appFails ? Promise.reject(appFails) : Promise.resolve({ mountApp });
        }),
        reportFatal: vi.fn(),
    };
    return { order, steps, mountApp };
}

describe('bootstrap order (ROK-1779)', () => {
    it.each([
        ['true', true, 'init:true'],
        ['false', false, 'init:false'],
        ['absent', undefined, 'init:undefined'],
    ])('initialises Sentry before importing the app when the flag is %s', async (_l, flag, init) => {
        const { order, steps, mountApp } = recordingSteps(() => Promise.resolve(status(flag)));
        await bootstrap(steps);
        expect(order).toEqual(['status', init, 'import-app', 'mount']);
        expect(mountApp).toHaveBeenCalledWith(status(flag));
    });

    it('treats a failed status fetch as OFF and still mounts', async () => {
        const { order, steps, mountApp } = recordingSteps(() => Promise.reject(new Error('offline')));
        await bootstrap(steps);
        expect(order).toEqual(['status', 'init:undefined', 'import-app', 'mount']);
        expect(mountApp).toHaveBeenCalledWith(null);
    });

    it('treats a status fetch past the timeout as OFF, aborts it, and mounts anyway', async () => {
        let seen: AbortSignal | undefined;
        const { order, steps, mountApp } = recordingSteps((signal) => {
            seen = signal;
            return new Promise<SystemStatusDto>(() => {});
        });
        await bootstrap(steps, 5);
        expect(order).toEqual(['status', 'init:undefined', 'import-app', 'mount']);
        expect(seen?.aborted, 'the timed-out status request is aborted').toBe(true);
        expect(mountApp).toHaveBeenCalledWith(null);
    });

    it('hands a failed app import to reportFatal with the telemetry decision', async () => {
        const boom = new Error('App module evaluation threw');
        const { steps, mountApp } = recordingSteps(() => Promise.resolve(status(true)), boom);
        await bootstrap(steps);
        expect(steps.reportFatal).toHaveBeenCalledExactlyOnceWith(boom, true);
        expect(mountApp).not.toHaveBeenCalled();
    });

    it('statusWithin resolves a fast status untouched', async () => {
        await expect(statusWithin(() => Promise.resolve(status(true)), 1000)).resolves.toEqual(status(true));
    });

    it('renderBootFailure shows a minimal alert in #root', () => {
        const root = document.createElement('div');
        root.append(document.createElement('span'));
        renderBootFailure(root);
        expect(root.querySelector('[role="alert"]')?.textContent).toMatch(/failed to load/i);
        expect(root.childElementCount).toBe(1);
    });
});

/** main.tsx's static import graph (relative specifiers only), as repo-relative paths. */
const here = dirname(fileURLToPath(import.meta.url));
const IMPORT_RE = /^(?:import|export)\s+(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/gm;

function resolveLocal(fromFile: string, spec: string): string | null {
    if (!spec.startsWith('.')) return null;
    const base = join(dirname(fromFile), spec);
    const hit = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find(
        (p) => existsSync(p) && /\.tsx?$/.test(p),
    );
    return hit ?? null;
}

function staticGraph(entry: string): string[] {
    const seen = new Set<string>();
    const walk = (file: string): void => {
        if (seen.has(file)) return;
        seen.add(file);
        const src = stripComments(readFileSync(file, 'utf8'));
        for (const m of src.matchAll(IMPORT_RE)) {
            const next = m[1] === undefined ? null : resolveLocal(file, m[1]);
            if (next) walk(next);
        }
    };
    walk(join(here, entry));
    return [...seen].map((f) => relative(here, f).split('\\').join('/'));
}

describe('main.tsx evaluates nothing of the app before the telemetry decision (ROK-1779)', () => {
    const graph = staticGraph('main.tsx');

    it('never statically reaches App, app-entry or native-fetch', () => {
        const forbidden = graph.filter((f) => /^(App\.tsx|app-entry\.tsx|lib\/api\/native-fetch\.ts)$/.test(f));
        expect(forbidden, 'these would evaluate before Sentry wraps fetch/XHR').toEqual([]);
    });

    it('loads the app through a dynamic import of ./app-entry', () => {
        expect(graph).toContain('bootstrap.ts');
        expect(stripComments(readFileSync(join(here, 'main.tsx'), 'utf8'))).toContain("import('./app-entry')");
    });
});
