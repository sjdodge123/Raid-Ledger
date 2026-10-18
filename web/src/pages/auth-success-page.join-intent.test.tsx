/**
 * ROK-1839 fix round r1 — Codex P1 / Opus MAJOR.
 *
 * The deferred-signup round trip ends here: /join parks `{intent, eventId,
 * token}` in sessionStorage, Discord bounces back to /auth/success, and this
 * page sends the user on to /join. That last hop is a CLIENT-SIDE navigation,
 * so the module-load strip in `lib/query-token-capture` never re-runs and
 * Sentry + Session Replay are already recording — a rebuilt
 * `/join?...&token=` would put the sign-in token straight into a replay's
 * rrweb Meta href, which no `beforeAddRecordingEvent` hook can reach.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import { renderWithProviders } from '../test/render-helpers';
import { defined } from '../test/defined';
import { AuthSuccessPage } from './auth-success-page';

const mockNavigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-router-dom')>()),
    useNavigate: () => mockNavigate,
}));

const login = vi.hoisted(() => vi.fn());
vi.mock('../hooks/use-auth', () => ({ useAuth: () => ({ login }) }));
vi.mock('../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('../components/auth', () => ({ consumeAuthRedirect: () => null }));

const setCaptured = vi.hoisted(() => vi.fn());
vi.mock('../lib/query-token-capture', () => ({
    setCapturedQueryToken: setCaptured,
    clearCapturedQueryToken: vi.fn(),
    peekCapturedQueryToken: () => null,
}));

const API = 'http://localhost:3000';
const INTENT_TOKEN = 'rok1839.intent.jwt';

describe('AuthSuccessPage — ROK-1839: the post-OAuth join hop carries no ?token=', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        vi.clearAllMocks();
        login.mockResolvedValue({
            id: 5, username: 'returning', role: 'member', onboardingCompletedAt: '2026-01-01T00:00:00Z',
        });
        server.use(http.post(`${API}/auth/exchange-code`, () =>
            HttpResponse.json({ access_token: 'header.payload.sig' })));
        sessionStorage.setItem('join_intent', JSON.stringify({
            intent: 'signup', eventId: '42', token: INTENT_TOKEN,
        }));
    });

    it('navigates to a token-free /join and hands the token over out-of-band', async () => {
        renderWithProviders(<AuthSuccessPage />, { initialEntries: ['/auth/success?code=abc123'] });

        await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
        const [path] = defined(mockNavigate.mock.calls[0], 'the post-OAuth navigate') as [string];

        expect(path, 'the rebuilt join URL must not carry the intent token').toBe('/join?intent=signup&eventId=42');
        expect(path, 'no part of it may contain the token value').not.toContain(INTENT_TOKEN);
        expect(setCaptured, 'the token reaches /join through the capture instead').toHaveBeenCalledWith({
            token: INTENT_TOKEN, eventId: '42', intent: 'signup',
        });
    });

    it('consumes the parked intent so a later login cannot replay it', async () => {
        renderWithProviders(<AuthSuccessPage />, { initialEntries: ['/auth/success?code=abc123'] });

        await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
        expect(sessionStorage.getItem('join_intent')).toBeNull();
    });
});
