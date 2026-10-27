/** ROK-2022: the Google OAuth start carries the signed `return=onboarding` target. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import { GOOGLE_CONSENT_URL_FIXTURE, GOOGLE_OAUTH_START_URL } from '../test/mocks/calendar-sync-handlers';

vi.mock('./use-auth', () => ({ getAuthToken: () => 'test-token' }));

import { useStartGoogleConnect, useStartOAuth } from './use-calendar-sync';

function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    return createElement(QueryClientProvider, { client }, children);
}

const realLocation = window.location;
let assign: ReturnType<typeof vi.fn>;
let queries: string[];

beforeEach(() => {
    assign = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { ...realLocation, assign } });
    queries = [];
    server.use(http.get(GOOGLE_OAUTH_START_URL, ({ request }) => {
        queries.push(new URL(request.url).search);
        return HttpResponse.json({ url: GOOGLE_CONSENT_URL_FIXTURE });
    }));
});
afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: realLocation });
});

async function startAndCapture(mutate: () => void): Promise<string> {
    mutate();
    await waitFor(() => expect(assign).toHaveBeenCalledWith(GOOGLE_CONSENT_URL_FIXTURE));
    expect(queries).toHaveLength(1);
    return queries[0] ?? '';
}

describe('Google OAuth start return target', () => {
    it('useStartGoogleConnect("onboarding") sends return=onboarding and no intent', async () => {
        const { result } = renderHook(() => useStartGoogleConnect('onboarding'), { wrapper });
        expect(await startAndCapture(() => result.current.mutate())).toBe('?return=onboarding');
    });

    it('without a target the start query stays empty (Integrations return unchanged)', async () => {
        const { result } = renderHook(() => useStartGoogleConnect(), { wrapper });
        expect(await startAndCapture(() => result.current.mutate())).toBe('');
    });

    it('carries both intent and return when asked', async () => {
        const { result } = renderHook(() => useStartOAuth('primary', 'onboarding'), { wrapper });
        expect(await startAndCapture(() => result.current.mutate())).toBe('?intent=primary&return=onboarding');
    });
});
