/**
 * ROK-1839 fix round r2 — Opus M4.
 *
 * `auth-success-page.join-intent.test.tsx` and `join-page.test.tsx` both mock
 * `../lib/query-token-capture`, so each END of the hand-off is pinned against
 * a double and the SEAM between them — the record the post-OAuth hop writes
 * with `setCapturedQueryToken`, read back by /join through
 * `peekCapturedQueryToken` — was covered only by composition. A change to the
 * record's shape could keep all of them green and still break the hop.
 *
 * This file mocks the NETWORK and nothing else: the real capture module, the
 * real router, the real page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { JoinPage } from './join-page';
import { redeemIntent } from '../lib/api-client';
import {
    CAPTURE_TTL_MS, QUERY_TOKEN_STORAGE_KEY,
    clearCapturedQueryToken, peekCapturedQueryToken, setCapturedQueryToken,
} from '../lib/query-token-capture';

vi.mock('../lib/api-client', () => ({ redeemIntent: vi.fn() }));
vi.mock('../lib/toast', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));
const auth = vi.hoisted(() => ({ current: { isAuthenticated: true, isLoading: false } }));
vi.mock('../hooks/use-auth', () => ({ useAuth: () => auth.current }));

const HANDED_OVER = 'hop.handed.intent.token';

function joinTree(search: string) {
    return (
        <MemoryRouter initialEntries={[`/join${search}`]}>
            <Routes>
                <Route path="/join" element={<JoinPage />} />
                <Route path="/events/:id" element={<div>Event Page</div>} />
                <Route path="/calendar" element={<div>Calendar Page</div>} />
            </Routes>
        </MemoryRouter>
    );
}

function renderJoin(search: string) {
    return render(joinTree(search));
}

describe('ROK-1839: the post-OAuth hand-off works against the REAL capture module', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.sessionStorage.clear();
        auth.current = { isAuthenticated: true, isLoading: false };
        clearCapturedQueryToken();
        window.history.replaceState(null, '', '/');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        clearCapturedQueryToken();
    });

    it('redeems exactly the token the hop handed over, then spends it', async () => {
        // What auth-success-page does after Discord sends the user back.
        setCapturedQueryToken({ token: HANDED_OVER, eventId: '42', intent: 'signup' });
        vi.mocked(redeemIntent).mockResolvedValueOnce({
            success: true, eventId: 42, message: "You're signed up!",
        });

        renderJoin('?intent=signup&eventId=42');

        await waitFor(() => expect(
            redeemIntent,
            'the token the hop stored must be the one /join sends, with no address bar in between',
        ).toHaveBeenCalledWith(HANDED_OVER));
        expect(await screen.findByText('Event Page')).toBeInTheDocument();
        expect(peekCapturedQueryToken(), 'a redeemed token is spent').toBeNull();
        expect(
            window.sessionStorage.getItem(QUERY_TOKEN_STORAGE_KEY),
            'and the sessionStorage mirror goes with it, so a reload cannot replay it',
        ).toBeNull();
    });

    it('does not redeem a hand-off that has aged past the TTL', async () => {
        setCapturedQueryToken({ token: HANDED_OVER, eventId: '42', intent: 'signup' });
        vi.spyOn(Date, 'now').mockReturnValue(Date.now() + CAPTURE_TTL_MS + 1);

        renderJoin('?intent=signup&eventId=42');

        expect(
            screen.getByRole('heading', { name: /invalid link/i }),
            'an expired hand-off leaves the page with no token, which is an invalid link',
        ).toBeInTheDocument();
        expect(redeemIntent, 'an expired capture is never sent to the server').not.toHaveBeenCalled();
    });

    it('does not redeem a hand-off taken for a different event', async () => {
        setCapturedQueryToken({ token: HANDED_OVER, eventId: '99', intent: 'signup' });

        renderJoin('?intent=signup&eventId=42');

        expect(screen.getByRole('heading', { name: /invalid link/i })).toBeInTheDocument();
        expect(redeemIntent, "event 99's token must not be redeemed on event 42's page").not.toHaveBeenCalled();
        await waitFor(() => expect(
            peekCapturedQueryToken(),
            'and it does not sit in the tab waiting for the next page',
        ).toBeNull());
    });

    /**
     * r3 (Codex P2). The TTL is enforced on every READ of the capture, so it
     * only protects the page if the page reads again when it matters. Auth
     * settles on a later render than the one that first resolved the capture:
     * a visitor who takes longer than the capture's life to come back signed
     * in used to have the memoized, long-dead token submitted for them.
     */
    it('does not redeem a hand-off that crosses the TTL while auth is still settling', () => {
        setCapturedQueryToken({ token: HANDED_OVER, eventId: '42', intent: 'signup' });
        auth.current = { isAuthenticated: false, isLoading: true };
        // A FRESH element each pass: React bails out of re-rendering a
        // subtree handed the identical element object, so reusing one would
        // never let the page resolve the capture again.
        const { rerender } = render(joinTree('?intent=signup&eventId=42'));

        vi.spyOn(Date, 'now').mockReturnValue(Date.now() + CAPTURE_TTL_MS + 1);
        auth.current = { isAuthenticated: true, isLoading: false };
        rerender(joinTree('?intent=signup&eventId=42'));

        expect(
            vi.mocked(redeemIntent).mock.calls,
            'a capture that aged past its TTL while auth was settling must never reach the server',
        ).toEqual([]);
        expect(
            screen.getByRole('heading', { name: /invalid link/i }),
            'an expired hand-off leaves the page with no token, which is an invalid link',
        ).toBeInTheDocument();
        expect(peekCapturedQueryToken(), 'and the dead capture is gone from the tab').toBeNull();
    });
});
