/** ROK-1870 W1/W2 — the game page "Community hubs" card. */
import { afterEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import {
    communityHubHandlers, createMockGameHubs, createMockHubEntry, createMockHubProposal,
} from '../../test/handlers/community-hubs';
import { CommunityHubsSection } from './community-hubs-section';

const API = 'http://localhost:3000';
const FOUR_HUBS = [1, 2, 3, 4].map((id) => createMockHubEntry({ id, name: `Hub ${id}`, memberCount: 10 }));

function renderCard(): void {
    renderWithProviders(<CommunityHubsSection gameId={5} gameName="Baldur's Gate 3" />);
}

afterEach(() => server.resetHandlers());

describe('CommunityHubsSection', () => {
    it('W1: lists three hubs, links to all four and shows the pending proposal', async () => {
        server.use(...communityHubHandlers({ gameHubs: createMockGameHubs({ hubs: FOUR_HUBS, myProposals: [createMockHubProposal()] }) }));
        renderCard();
        expect(await screen.findByText('Hub 1')).toBeInTheDocument();
        expect(screen.getByText('Hub 3')).toBeInTheDocument();
        expect(screen.queryByText('Hub 4')).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'See all 4 hubs' })).toHaveAttribute('href', '/hubs?game=5');
        expect(screen.getByText('Late-Night Larian')).toBeInTheDocument();
        expect(screen.getByText('Pending review')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
    });

    it('W2: a blocked viewer sees the Start button disabled with the reason', async () => {
        server.use(...communityHubHandlers({ gameHubs: createMockGameHubs({ canPropose: false, proposeBlockedReason: 'limit-reached' }) }));
        renderCard();
        const start = await screen.findByRole('button', { name: 'Start a community hub' });
        expect(start).toBeDisabled();
        expect(screen.getByText('You already have two proposals waiting for review.')).toBeInTheDocument();
    });

    it('shows the empty state when the game has no hubs', async () => {
        server.use(...communityHubHandlers());
        renderCard();
        expect(await screen.findByText("No community hubs for Baldur's Gate 3 yet — start the first one.")).toBeInTheDocument();
        expect(screen.queryByText('Your proposals')).not.toBeInTheDocument();
    });

    it('joins inline: the row flips to Joined and the count rises', async () => {
        server.use(...communityHubHandlers({ gameHubs: createMockGameHubs({ hubs: [createMockHubEntry({ memberCount: 14 })] }) }));
        renderCard();
        await userEvent.click(await screen.findByRole('button', { name: 'Join Tavern Regulars' }));
        expect(await screen.findByText('Joined')).toBeInTheDocument();
        expect(screen.getByText('15 members')).toBeInTheDocument();
    });

    it('withdraws a proposal after the inline confirm', async () => {
        let deleted = 0;
        server.use(
            http.delete(`${API}/hubs/proposals/:id`, () => { deleted += 1; return new HttpResponse(null, { status: 204 }); }),
            ...communityHubHandlers({ gameHubs: createMockGameHubs({ myProposals: [createMockHubProposal()] }) }),
        );
        renderCard();
        await userEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
        expect(deleted).toBe(0);
        await userEvent.click(screen.getByRole('button', { name: 'Yes, withdraw' }));
        await waitFor(() => expect(deleted).toBe(1));
    });
    it('a failed read keeps the card with an error line and a Retry that refetches', async () => {
        let calls = 0;
        server.use(http.get(`${API}/hubs/by-game/5`, () => { calls += 1; return HttpResponse.json({ message: 'boom' }, { status: 500 }); }));
        renderCard();
        expect(await screen.findByTestId('community-hubs-error')).toHaveTextContent('Couldn’t load community hubs');
        const before = calls;
        await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(calls).toBeGreaterThan(before));
    });

    it('says "1 member" in the singular', async () => {
        server.use(...communityHubHandlers({ gameHubs: createMockGameHubs({ hubs: [createMockHubEntry({ memberCount: 1 })] }) }));
        renderCard();
        expect(await screen.findByText('1 member')).toBeInTheDocument();
    });
});
