import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * ROK-1779 (Codex r6): main.tsx itself — Sentry initialises before the app
 * module is imported, and a throw while the app's modules evaluate is
 * captured when telemetry is ON (and only shown when OFF).
 */
const h = vi.hoisted(() => ({
    order: [] as string[],
    appThrows: null as Error | null,
    capture: vi.fn(),
    mountApp: vi.fn(),
}));

vi.mock('./sentry', () => ({
    Sentry: { captureException: h.capture },
    initSentry: (on: boolean | undefined) => {
        h.order.push(`init:${String(on)}`);
        return on === true;
    },
}));

/** The app module: its factory runs when main.tsx dynamically imports it (doMock, so per test). */
function mockAppEntry(): void {
    vi.doMock('./app-entry', () => {
        h.order.push('app-import');
        if (h.appThrows) throw h.appThrows;
        return { mountApp: (...args: unknown[]) => { h.order.push('mount'); h.mountApp(...args); } };
    });
}

function serveStatus(body: unknown): void {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))));
}

async function runMain(until: string): Promise<void> {
    await import('./main');
    await vi.waitFor(() => { expect(h.order).toContain(until); });
}

beforeEach(() => {
    vi.resetModules();
    mockAppEntry();
    h.order.length = 0;
    h.appThrows = null;
    h.capture.mockReset();
    h.mountApp.mockReset();
    document.body.innerHTML = '<div id="root"></div>';
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('main.tsx boot order (ROK-1779)', () => {
    it('initialises Sentry before the app module is imported, then mounts with the status', async () => {
        serveStatus({ telemetryEnabled: true });
        await runMain('mount');
        expect(h.order).toEqual(['init:true', 'app-import', 'mount']);
        expect(h.mountApp).toHaveBeenCalledWith({ telemetryEnabled: true });
    });

    it('a failed status fetch decides OFF and the app still mounts', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
        await runMain('mount');
        expect(h.order).toEqual(['init:undefined', 'app-import', 'mount']);
        expect(h.mountApp).toHaveBeenCalledWith(null);
    });

    it('captures a module-evaluation throw in the app once when telemetry is ON, and shows an error', async () => {
        h.appThrows = new Error('App module evaluation threw');
        serveStatus({ telemetryEnabled: true });
        await runMain('app-import');
        await vi.waitFor(() => { expect(h.capture).toHaveBeenCalledTimes(1); });
        // Vitest wraps a throwing mock factory; the module's own error is the cause.
        const captured: unknown = h.capture.mock.calls[0]?.[0];
        const original = captured instanceof Error && captured.cause !== undefined ? captured.cause : captured;
        expect(original, 'the app module-evaluation error reaches Sentry').toBe(h.appThrows);
        expect(document.querySelector('#root [role="alert"]')?.textContent).toMatch(/failed to load/i);
    });

    it('sends nothing for a module-evaluation throw when telemetry is OFF, but still shows an error', async () => {
        h.appThrows = new Error('App module evaluation threw');
        serveStatus({ telemetryEnabled: false });
        await runMain('app-import');
        await vi.waitFor(() => { expect(document.querySelector('#root [role="alert"]')).not.toBeNull(); });
        expect(h.capture).not.toHaveBeenCalled();
    });
});
