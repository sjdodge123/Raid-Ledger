/** `useConnectApple` (ROK-1598 L5a): each refusal maps to its `AppleConnectFailure`. */
import { describe, it, expect, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import { createTestQueryClient } from '../test/render-helpers';
import {
    APPLE_CONNECT_URL, APPLE_PASSWORD_DOWN, APPLE_PASSWORD_FAIL, appleConnectThrottledHandler, userCalendarHandlers,
} from '../test/mocks/calendar-sync-handlers';
import { useConnectApple, type AppleConnectFailure } from './use-calendar-sync';

const EMAIL = 'raider@icloud.com';

function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

async function failureFor(appPassword: string): Promise<AppleConnectFailure | undefined> {
    const { result } = renderHook(() => useConnectApple(), { wrapper });
    result.current.mutate({ email: EMAIL, appPassword });
    await waitFor(() => expect(result.current.isError).toBe(true));
    return result.current.error?.failure;
}

beforeEach(() => server.use(...userCalendarHandlers()));

describe('useConnectApple', () => {
    it('201 → the parsed Apple connection', async () => {
        const { result } = renderHook(() => useConnectApple(), { wrapper });
        result.current.mutate({ email: EMAIL, appPassword: 'abcd-efgh-ijkl-mnop' });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.provider).toBe('apple');
        expect(result.current.data?.accountLabel).toBe(EMAIL);
    });

    it('400 apple_auth_failed → apple_auth_failed', async () => {
        expect(await failureFor(APPLE_PASSWORD_FAIL)).toBe('apple_auth_failed');
    });

    it('400 invalid_input → invalid_input', async () => {
        expect(await failureFor('bad')).toBe('invalid_input');
    });

    it('503 apple_unavailable → apple_unavailable', async () => {
        expect(await failureFor(APPLE_PASSWORD_DOWN)).toBe('apple_unavailable');
    });

    it('429 throttle → throttled', async () => {
        server.use(appleConnectThrottledHandler());
        expect(await failureFor('abcd-efgh-ijkl-mnop')).toBe('throttled');
    });

    it('no answer (network error) → network', async () => {
        server.use(http.post(APPLE_CONNECT_URL, () => HttpResponse.error()));
        expect(await failureFor('abcd-efgh-ijkl-mnop')).toBe('network');
    });

    it('a 5xx without a code body → apple_unavailable', async () => {
        server.use(http.post(APPLE_CONNECT_URL, () => new HttpResponse('<html>', { status: 502 })));
        expect(await failureFor('abcd-efgh-ijkl-mnop')).toBe('apple_unavailable');
    });
});
