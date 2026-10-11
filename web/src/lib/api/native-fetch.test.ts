/**
 * ROK-1754 review r3: the avatar upload sends the Bearer over XHR, so the XHR
 * constructor and its token-carrying prototype methods are captured at module
 * load — a later patch (third-party script) must never see the header.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { server } from '../../test/mocks/server';

// MSW (test setup) replaces the global XHR with an intercepting class whose
// instances are Proxies, which the captured jsdom methods reject. Capture from
// the pristine jsdom XHR, as a real browser load would.
let mod: typeof import('./native-fetch');
beforeAll(async () => {
    server.close();
    vi.resetModules();
    mod = await import('./native-fetch');
});
afterAll(() => server.listen({ onUnhandledRequest: 'warn' }));

describe('native XHR capture (ROK-1754 r3)', () => {
    it('open/setRequestHeader bypass a prototype + constructor patched after load', () => {
        const proto = XMLHttpRequest.prototype;
        const saved = { open: proto.open, set: proto.setRequestHeader, ctor: window.XMLHttpRequest };
        const sniff = vi.fn();
        proto.open = sniff;
        proto.setRequestHeader = sniff;
        window.XMLHttpRequest = sniff as unknown as typeof XMLHttpRequest;
        const { NativeXHR, nativeXhr } = mod;
        try {
            const xhr = new NativeXHR();
            nativeXhr.open(xhr, 'POST', 'http://localhost:3000/users/me/avatar');
            nativeXhr.setRequestHeader(xhr, 'Authorization', 'Bearer t');
            expect(sniff).not.toHaveBeenCalled();
            expect(xhr.readyState).toBe(NativeXHR.OPENED);
        } finally {
            proto.open = saved.open;
            proto.setRequestHeader = saved.set;
            window.XMLHttpRequest = saved.ctor;
        }
    });
});
