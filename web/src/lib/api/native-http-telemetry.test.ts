/**
 * ROK-1779 (Codex r5): the captured native clients record their own Sentry
 * breadcrumbs + spans when telemetry is ON, nothing when OFF, and the
 * ROK-1754 capture-at-load still ignores a later-replaced `window.fetch`.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const sentry = vi.hoisted(() => ({
    getClient: vi.fn<() => object | undefined>(),
    addBreadcrumb: vi.fn(),
    startSpan: vi.fn((_opts: unknown, cb: (span: { setAttribute: () => void }) => unknown) =>
        cb({ setAttribute: () => undefined })),
    startInactiveSpan: vi.fn(() => ({ setAttribute: vi.fn(), end: vi.fn() })),
}));
vi.mock('@sentry/react', () => sentry);

const original = vi.fn(async () => new Response('{"access_token":"secret-body"}', { status: 201 }));
let mod: typeof import('./native-fetch');
let telemetry: typeof import('./native-http-telemetry');

beforeAll(async () => {
    const saved = window.fetch;
    window.fetch = original;
    vi.resetModules();
    mod = await import('./native-fetch');
    telemetry = await import('./native-http-telemetry');
    window.fetch = saved;
});

beforeEach(() => {
    vi.clearAllMocks();
});

const URL_WITH_PII = 'http://localhost:3000/users/alice@example.com/avatar?token=abc123&q=bob';
const INIT = { method: 'post', headers: { Authorization: 'Bearer t0k' }, body: 'request-body' };

describe('native client telemetry (ROK-1779 r5)', () => {
    it('records a scrubbed fetch breadcrumb + http.client span when telemetry is ON', async () => {
        sentry.getClient.mockReturnValue({});
        const res = await mod.nativeFetch(URL_WITH_PII, INIT);
        expect(res.status).toBe(201);
        expect(sentry.startSpan).toHaveBeenCalledWith(
            expect.objectContaining({ op: 'http.client' }),
            expect.any(Function),
        );
        expect(sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
        const crumb = sentry.addBreadcrumb.mock.calls[0]?.[0];
        expect(crumb).toMatchObject({
            category: 'fetch',
            data: { method: 'POST', url: 'http://localhost:3000/users/[email]/avatar', status_code: 201 },
        });
        const sent = JSON.stringify([crumb, sentry.startSpan.mock.calls[0]?.[0]]);
        for (const leak of ['abc123', 'bob', 'Bearer', 't0k', 'request-body', 'secret-body', 'alice']) {
            expect(sent).not.toContain(leak);
        }
    });

    it('records nothing when telemetry is OFF and passes the call straight through', async () => {
        sentry.getClient.mockReturnValue(undefined);
        await mod.nativeFetch(URL_WITH_PII, INIT);
        expect(original).toHaveBeenCalledWith(URL_WITH_PII, INIT);
        expect(sentry.addBreadcrumb).not.toHaveBeenCalled();
        expect(sentry.startSpan).not.toHaveBeenCalled();
    });

    it('still calls the fetch captured at load after window.fetch is replaced', async () => {
        sentry.getClient.mockReturnValue({});
        const saved = window.fetch;
        const sniff = vi.fn();
        window.fetch = sniff;
        try {
            await mod.nativeFetch('/api/auth/refresh', INIT);
        } finally {
            window.fetch = saved;
        }
        expect(sniff).not.toHaveBeenCalled();
        expect(original).toHaveBeenCalledTimes(1);
    });

    it('records a scrubbed xhr breadcrumb on loadend when ON, nothing when OFF', () => {
        const fakeXhr = () => Object.assign(new EventTarget(), { status: 200 }) as unknown as XMLHttpRequest;
        sentry.getClient.mockReturnValue(undefined);
        const off = fakeXhr();
        telemetry.noteXhrOpen(off, 'POST', URL_WITH_PII);
        telemetry.traceXhrSend(off);
        off.dispatchEvent(new Event('loadend'));
        expect(sentry.addBreadcrumb).not.toHaveBeenCalled();

        sentry.getClient.mockReturnValue({});
        const on = fakeXhr();
        telemetry.noteXhrOpen(on, 'post', URL_WITH_PII);
        telemetry.traceXhrSend(on);
        on.dispatchEvent(new Event('loadend'));
        expect(sentry.addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({
            category: 'xhr',
            data: expect.objectContaining({
                method: 'POST', url: 'http://localhost:3000/users/[email]/avatar', status_code: 200,
            }),
        }));
    });
});
