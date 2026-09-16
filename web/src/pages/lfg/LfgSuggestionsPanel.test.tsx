/**
 * ROK-1464 AC5 — "Might want in" — plus the ROK-1455 invite button (T-C1..C3).
 *
 * Every row must carry a REASON — an unexplained suggestion is indistinguishable
 * from a random player list. The Invite button posts one recipient per click
 * (D6); a live invite renders "Invited" and disables (D7); a recipient-scoped
 * refusal renders ONE neutral label and never a reason (D13); the group cap
 * (429) renders the server's actionable copy inline, not a generic error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import { server } from '../../test/mocks/server';
import {
    LFG_INVITE_CAP_FIXTURE_MESSAGE,
    lfgInviteHandler,
} from '../../test/mocks/lfg-handlers';
import { createMockSuggestion } from '../../test/lfg-factories';
import { toast } from '../../lib/toast';
import { LFG_COPY } from './lfg-copy';
import { LfgSuggestionsPanel } from './LfgSuggestionsPanel';

const GAME_ID = 7;

function renderPanel(suggestions = [createMockSuggestion()], gameId = GAME_ID) {
    return renderWithProviders(
        <LfgSuggestionsPanel
            gameId={gameId}
            suggestions={{ gameId, suggestions }}
        />,
    );
}

describe('LfgSuggestionsPanel', () => {
    it('names every reason a player was suggested for', () => {
        renderPanel([
            createMockSuggestion({
                displayName: 'Bo',
                reasons: ['played', 'owns'],
            }),
        ]);

        expect(screen.getByText('Bo')).toBeInTheDocument();
        expect(screen.getByText('played before')).toBeInTheDocument();
        expect(screen.getByText('owns it')).toBeInTheDocument();
        expect(
            screen.getByText('Has played this with the group'),
        ).toBeInTheDocument();
    });

    it('explains a hearted-only suggestion in its own words', () => {
        renderPanel([
            createMockSuggestion({
                userId: 5,
                displayName: null,
                username: 'cass',
                reasons: ['hearted'],
            }),
        ]);

        expect(screen.getByText('cass')).toBeInTheDocument();
        expect(screen.getByText('hearted it')).toBeInTheDocument();
        expect(screen.getByText('Hearted this game')).toBeInTheDocument();
    });

    it('says there is nobody to suggest when the list is empty', () => {
        renderPanel([]);

        expect(
            screen.getByText('Nobody else to suggest right now'),
        ).toBeInTheDocument();
        expect(screen.queryByTestId('lfg-invite-button')).toBeNull();
    });

    /**
     * ROK-1535 — a FAILED read must never render as an empty one. The panel
     * gets `undefined` either way, so without `isError` the operator reads a
     * 429 / 401 / 500 / schema rejection as "nobody owns this game" and the
     * failure is invisible.
     */
    it('reports a failed read instead of claiming there is nobody', () => {
        renderWithProviders(
            <LfgSuggestionsPanel
                gameId={GAME_ID}
                suggestions={undefined}
                isError
            />,
        );

        expect(screen.getByTestId('lfg-suggestions-error')).toHaveTextContent(
            LFG_COPY.suggestionsFailed,
        );
        expect(screen.queryByText(LFG_COPY.suggestionsEmpty)).toBeNull();
    });

    it('shows the loading state, not the empty copy, while the read is in flight', () => {
        renderWithProviders(
            <LfgSuggestionsPanel
                gameId={GAME_ID}
                suggestions={undefined}
                isLoading
            />,
        );

        expect(screen.getByText('Loading…')).toBeInTheDocument();
        expect(screen.queryByText(LFG_COPY.suggestionsEmpty)).toBeNull();
    });
});

describe('LfgSuggestionsPanel — invite button (ROK-1455)', () => {
    beforeEach(() => {
        vi.spyOn(toast, 'error').mockImplementation(() => 'toast-id');
    });
    afterEach(() => vi.restoreAllMocks());

    it('T-C1: clicking Invite posts that recipient to the group route and flips the row to Invited', async () => {
        const { handler, bodies } = lfgInviteHandler({
            status: 'sent',
            reason: null,
        });
        server.use(handler);
        renderPanel([createMockSuggestion({ userId: 42 })]);

        const button = screen.getByTestId('lfg-invite-button');
        expect(button).toBeEnabled();
        expect(button).toHaveTextContent(LFG_COPY.invite);

        await userEvent.click(button);

        await waitFor(() =>
            expect(bodies).toEqual([{ gameId: String(GAME_ID), userId: 42 }]),
        );
        await waitFor(() =>
            expect(screen.getByTestId('lfg-invite-button')).toHaveTextContent(
                LFG_COPY.invited,
            ),
        );
        expect(screen.getByTestId('lfg-invite-button')).toBeDisabled();
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('T-C2: a row whose inviteState is sent renders disabled as Invited', () => {
        renderPanel([createMockSuggestion({ inviteState: 'sent' })]);

        const button = screen.getByTestId('lfg-invite-button');
        expect(button).toBeDisabled();
        expect(button).toHaveTextContent(LFG_COPY.invited);
    });

    it('T-C3: a 429 renders the group-cap copy inline and locks every row, without a generic error', async () => {
        const { handler, bodies } = lfgInviteHandler({
            status: 429,
            message: LFG_INVITE_CAP_FIXTURE_MESSAGE,
        });
        server.use(handler);
        renderPanel([
            createMockSuggestion({ userId: 2 }),
            createMockSuggestion({
                userId: 3,
                username: 'cy',
                displayName: 'Cy',
            }),
        ]);

        await userEvent.click(screen.getAllByTestId('lfg-invite-button')[0]);

        expect(
            await screen.findByText(LFG_INVITE_CAP_FIXTURE_MESSAGE),
        ).toBeInTheDocument();
        // The cap state is entered on the coded body specifically — see T-C3e
        // for the throttler's un-coded 429, which must NOT lock the panel.
        expect(bodies).toEqual([{ gameId: String(GAME_ID), userId: 2 }]);
        for (const button of screen.getAllByTestId('lfg-invite-button')) {
            expect(button).toBeDisabled();
        }
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('T-C3b: a skipped outcome renders the neutral unavailable label and never a reason', async () => {
        server.use(
            lfgInviteHandler({ status: 'skipped', reason: 'unavailable' })
                .handler,
        );
        renderPanel();

        await userEvent.click(screen.getByTestId('lfg-invite-button'));

        const button = await screen.findByText(LFG_COPY.inviteUnavailable);
        expect(button).toBeDisabled();
        expect(
            screen.queryByText(/opted out|declined|budget|rate/i),
        ).toBeNull();
        expect(screen.queryByTestId('lfg-invite-cap')).toBeNull();
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('T-C3c: a 429 with no body message falls back to the local cap copy', async () => {
        server.use(lfgInviteHandler({ status: 429, message: '' }).handler);
        renderPanel();

        await userEvent.click(screen.getByTestId('lfg-invite-button'));

        expect(
            await screen.findByText(LFG_COPY.inviteCapped),
        ).toBeInTheDocument();
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('T-C3e: a THROTTLER 429 (no cap code) is a toast and leaves the row retryable', async () => {
        // The API's global ThrottlerGuard answers 429 with its own generic
        // copy and no `code`. Treating it as the group cap painted throttle
        // copy into the cap notice and disabled every row (F1).
        server.use(
            http.post('http://localhost:3000/lfg/:gameId/invites', () =>
                HttpResponse.json(
                    {
                        statusCode: 429,
                        message: 'Too many requests. Please try again later.',
                    },
                    { status: 429 },
                ),
            ),
        );
        renderPanel();

        await userEvent.click(screen.getByTestId('lfg-invite-button'));

        await waitFor(() =>
            expect(toast.error).toHaveBeenCalledWith(LFG_COPY.inviteFailed),
        );
        expect(
            screen.queryByText('Too many requests. Please try again later.'),
        ).toBeNull();
        expect(screen.queryByText(LFG_COPY.inviteCapped)).toBeNull();
        expect(screen.getByTestId('lfg-invite-button')).toBeEnabled();
    });

    it('T-C3d: a non-cap failure is a toast, not the cap notice, and the row stays retryable', async () => {
        server.use(
            http.post('http://localhost:3000/lfg/:gameId/invites', () =>
                HttpResponse.json({ message: 'boom' }, { status: 500 }),
            ),
        );
        renderPanel();

        await userEvent.click(screen.getByTestId('lfg-invite-button'));

        await waitFor(() =>
            expect(toast.error).toHaveBeenCalledWith(LFG_COPY.inviteFailed),
        );
        expect(screen.queryByTestId('lfg-invite-cap')).toBeNull();
        expect(screen.getByTestId('lfg-invite-button')).toBeEnabled();
    });
});
