/**
 * ROK-1820 item 2: a refresh POSTed before the password change (under the
 * pre-change session) and answered after the change must not overwrite the
 * session the change re-issued, nor sign the admin out.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import { refreshWithOutcome } from '../lib/api/refresh-client';
import { clearAccessToken, getAccessToken, setAccessToken } from '../lib/api/access-token-store';
import { AUTH_METHOD_KEY } from '../lib/api/auth-storage-keys';
import { useOnboarding } from './use-onboarding';

vi.mock('../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const API = 'http://localhost:3000';

/** The refresh POST is held until `release()`; it answers with `stale.jwt`. */
function gatedRefresh(): () => void {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.post(`${API}/auth/refresh`, async () => {
        await gate;
        return HttpResponse.json({ access_token: 'stale.jwt' });
    }));
    return release;
}

function changePasswordReturns(token: string): void {
    server.use(http.post(`${API}/admin/onboarding/change-password`, () =>
        HttpResponse.json({ success: true, message: 'ok', access_token: token })));
}

function setup() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children);
    return renderHook(() => useOnboarding(), { wrapper }).result;
}

describe('ROK-1820: password change vs a late in-flight refresh', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem(AUTH_METHOD_KEY, 'local');
        clearAccessToken();
        setAccessToken('old.jwt');
    });

    it('a refresh started before the change and resolving after it does not replace the new token', async () => {
        const release = gatedRefresh();
        changePasswordReturns('fresh.jwt');
        const stale = refreshWithOutcome();
        const result = setup();
        act(() => { result.current.changePassword.mutate({ currentPassword: 'a', newPassword: 'b' }); });
        await waitFor(() => expect(result.current.changePassword.isSuccess).toBe(true));
        expect(getAccessToken()).toBe('fresh.jwt');
        release();
        await expect(stale).resolves.toEqual({ kind: 'indeterminate' });
        expect(getAccessToken(), 'the late pre-change refresh must not overwrite the re-issued token').toBe('fresh.jwt');
    });

    it('the dropped late refresh does not sign the admin out', async () => {
        const release = gatedRefresh();
        changePasswordReturns('fresh.jwt');
        const stale = refreshWithOutcome();
        const result = setup();
        act(() => { result.current.changePassword.mutate({ currentPassword: 'a', newPassword: 'b' }); });
        await waitFor(() => expect(result.current.changePassword.isSuccess).toBe(true));
        release();
        await stale;
        expect(localStorage.getItem(AUTH_METHOD_KEY), 'the session marker survives').toBe('local');
        expect(getAccessToken()).not.toBeNull();
    });
});
