/**
 * ROK-1367: the AI-suggestions client now routes through the shared
 * `fetchWithAuth` helper, so a 401 at the token-expiry boundary is
 * transparently refreshed + retried in exactly one place. These tests pin
 * that behaviour plus the 503 → "unavailable" branch the helper must NOT
 * swallow.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '../../test/mocks/server';
import { getAiSuggestions } from './ai-suggestions-api';
import { ACCESS_TOKEN_KEY, AUTH_METHOD_KEY } from './auth-storage-keys';

// Real Sentry import is heavy + irrelevant here; fetch-api pulls it in.
vi.mock('../../sentry', () => ({ Sentry: { captureException: vi.fn() } }));

const API_BASE = 'http://localhost:3000';

const RESOLVED_BODY = {
    suggestions: [],
    generatedAt: new Date().toISOString(),
    voterCount: 0,
    voterScopeStrategy: 'community',
    cached: false,
};

describe('getAiSuggestions — ROK-1367 transparent on-401 refresh', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        // A prior-session auth-method marker gates the refresh probe.
        localStorage.setItem(AUTH_METHOD_KEY, 'discord');
        localStorage.setItem(ACCESS_TOKEN_KEY, 'stale-token');
    });

    it('refreshes on a 401 and retries, returning the resolved payload', async () => {
        let suggestionCalls = 0;
        let refreshCalls = 0;
        server.use(
            http.post(`${API_BASE}/auth/refresh`, () => {
                refreshCalls += 1;
                return HttpResponse.json({ access_token: 'fresh-token' });
            }),
            http.get(`${API_BASE}/lineups/:id/suggestions`, () => {
                suggestionCalls += 1;
                if (suggestionCalls === 1) {
                    return new HttpResponse(null, { status: 401 });
                }
                return HttpResponse.json(RESOLVED_BODY);
            }),
        );

        const result = await getAiSuggestions(42);

        expect(result.kind).toBe('ok');
        expect(refreshCalls).toBe(1);
        expect(suggestionCalls).toBe(2);
        // The retry used the freshly-minted token.
        expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('fresh-token');
    });

    it('does not probe refresh for an anonymous 401 (no auth-method marker)', async () => {
        localStorage.removeItem(AUTH_METHOD_KEY);
        let suggestionCalls = 0;
        let refreshCalls = 0;
        server.use(
            http.post(`${API_BASE}/auth/refresh`, () => {
                refreshCalls += 1;
                return HttpResponse.json({ access_token: 'fresh-token' });
            }),
            http.get(`${API_BASE}/lineups/:id/suggestions`, () => {
                suggestionCalls += 1;
                return new HttpResponse(null, { status: 401 });
            }),
        );

        await expect(getAiSuggestions(42)).rejects.toThrow();
        expect(refreshCalls).toBe(0);
        expect(suggestionCalls).toBe(1);
    });

    it('surfaces a 503 as unavailable without a refresh or throw', async () => {
        let refreshCalls = 0;
        server.use(
            http.post(`${API_BASE}/auth/refresh`, () => {
                refreshCalls += 1;
                return HttpResponse.json({ access_token: 'fresh-token' });
            }),
            http.get(`${API_BASE}/lineups/:id/suggestions`, () =>
                new HttpResponse(null, { status: 503 }),
            ),
        );

        const result = await getAiSuggestions(42);

        expect(result.kind).toBe('unavailable');
        expect(refreshCalls).toBe(0);
    });
});
