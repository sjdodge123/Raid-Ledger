/**
 * ROK-1630 AC16 — the Discord link initiator POSTs /auth/discord/link/start
 * (Bearer header only) and then navigates to the single-use `?nonce=` hop.
 * The session JWT never rides in a URL.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('./use-auth', () => ({ getAuthToken: () => 'access-jwt' }));
vi.mock('../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { API_BASE_URL } from '../lib/config';
import { toast } from '../lib/toast';
import { useDiscordLink, useDiscordLinkAction } from './use-discord-link';

const realLocation = window.location;
let navigations: string[] = [];

function stubLocation() {
    navigations = [];
    Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: {
            get href() { return 'http://localhost/profile'; },
            set href(v: string) { navigations.push(v); },
        },
    });
}

function stubFetch(status: number, body: unknown) {
    const fn = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
    vi.stubGlobal('fetch', fn);
    return fn;
}

beforeEach(stubLocation);
afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: realLocation });
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe('useDiscordLink (ROK-1630 AC16)', () => {
    it('POSTs /auth/discord/link/start with the Bearer header and an empty JSON body', async () => {
        const fetchFn = stubFetch(200, { nonce: 'n.o.nce', expiresIn: 120 });
        const { result } = renderHook(() => useDiscordLink());
        await act(async () => { await result.current(); });

        expect(fetchFn).toHaveBeenCalledTimes(1);
        const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
        expect(url).toBe(`${API_BASE_URL}/auth/discord/link/start`);
        expect(init.method).toBe('POST');
        expect(init.headers.Authorization).toBe('Bearer access-jwt');
        expect(JSON.parse(String(init.body))).toEqual({});
    });

    it('navigates to the ?nonce= hop, never a ?token= URL', async () => {
        stubFetch(200, { nonce: 'n.o/nce', expiresIn: 120 });
        const { result } = renderHook(() => useDiscordLink());
        await act(async () => { await result.current(); });

        expect(navigations).toEqual([`${API_BASE_URL}/auth/discord/link?nonce=${encodeURIComponent('n.o/nce')}`]);
        expect(navigations[0]).not.toContain('token=');
    });

    it('a 401 from start shows the log-in-again toast and does not navigate', async () => {
        stubFetch(401, { message: 'Unauthorized' });
        const { result } = renderHook(() => useDiscordLink());
        await act(async () => { await result.current(); });

        expect(toast.error).toHaveBeenCalledWith('Please log in again to link Discord');
        expect(navigations).toEqual([]);
    });

    it('sends {} even when wired straight to onClick (the click event is not a returnTo)', async () => {
        const fetchFn = stubFetch(200, { nonce: 'n', expiresIn: 120 });
        const { result } = renderHook(() => useDiscordLink());
        const fakeEvent = { type: 'click', target: {} };
        await act(async () => { await (result.current as (e: unknown) => Promise<void>)(fakeEvent); });

        const init = fetchFn.mock.calls[0][1] as RequestInit;
        expect(JSON.parse(String(init.body))).toEqual({});
    });

    it('isPending is true while start is in flight; a second call does not POST again', async () => {
        let resolveFetch!: (v: unknown) => void;
        const fetchFn = vi.fn().mockReturnValue(new Promise((r) => { resolveFetch = r; }));
        vi.stubGlobal('fetch', fetchFn);
        const { result } = renderHook(() => useDiscordLinkAction());

        let first!: Promise<void>;
        act(() => { first = result.current.linkDiscord(); });
        expect(result.current.isPending).toBe(true);
        await act(async () => { await result.current.linkDiscord(); });
        expect(fetchFn).toHaveBeenCalledTimes(1);

        await act(async () => {
            resolveFetch({ ok: false, status: 401, json: async () => ({}) });
            await first;
        });
        expect(result.current.isPending).toBe(false);
        expect(navigations).toEqual([]);
    });
});
