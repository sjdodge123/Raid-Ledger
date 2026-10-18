/**
 * ROK-1830 S5b — the Players-page "get your guild" card: shown to a signed-in
 * viewer with no hub, gone once dismissed, and never shown to a viewer who
 * already has one (the WoW slot renders their guild cards instead).
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { HubOnboardingStateDto, MyGuilds } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { GetYourGuildCard } from './get-your-guild-card';
import { PlayersGuildCard } from '../../../plugins/wow/slots/players-guild-card';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const URL = 'http://localhost:3000/guilds/onboarding';
const MINE = 'http://localhost:3000/plugins/wow/guilds/mine';
const EMPTY: HubOnboardingStateDto = { dismissed: [] };

function serveOnboarding(state: HubOnboardingStateDto = EMPTY): void {
    server.use(http.get(URL, () => HttpResponse.json(state)));
}

describe('GetYourGuildCard', () => {
    it('shows the pitch and the module how-to line', async () => {
        serveOnboarding();
        renderWithProviders(<GetYourGuildCard how="Install LedgerLink." />);
        await screen.findByTestId('get-your-guild-card');
        expect(screen.getByRole('heading', { name: 'Get your guild on Raid Ledger' })).toBeInTheDocument();
        expect(screen.getByTestId('get-your-guild-how')).toHaveTextContent('Install LedgerLink.');
    });

    it('dismissing it takes the card off the page', async () => {
        serveOnboarding();
        server.use(http.post(`${URL}/players-get-your-guild/dismiss`, () => HttpResponse.json({
            dismissed: [{ key: 'players-get-your-guild', guildId: null, dismissedAt: '2026-10-02T00:00:00.000Z' }],
        } satisfies HubOnboardingStateDto)));
        renderWithProviders(<GetYourGuildCard />);
        await userEvent.click(await screen.findByTestId('get-your-guild-dismiss'));
        await waitFor(() => expect(screen.queryByTestId('get-your-guild-card')).not.toBeInTheDocument());
    });

    it('a stored dismissal means it never appears', async () => {
        serveOnboarding({ dismissed: [{ key: 'players-get-your-guild', guildId: null, dismissedAt: '2026-10-01T00:00:00.000Z' }] });
        renderWithProviders(<GetYourGuildCard />);
        await waitFor(() => expect(screen.queryByTestId('get-your-guild-card')).not.toBeInTheDocument());
    });
});

describe('PlayersGuildCard', () => {
    it('a viewer with a hub gets their guild card, not the prompt', async () => {
        serveOnboarding();
        server.use(http.get(MINE, () => HttpResponse.json({
            guilds: [{
                id: 11, gameId: 1, kind: 'wow_guild', name: 'Iron Vanguard', region: 'us', realmSlug: null, realmName: 'Doomhowl',
                faction: 'Horde', memberCount: 12, lastSnapshotAt: null, rankIndex: 0, rankName: 'GM', canEdit: true, gmPostHeadline: null,
            }],
        } satisfies MyGuilds)));
        renderWithProviders(<PlayersGuildCard />);
        await screen.findByTestId('players-guild-card');
        expect(screen.queryByTestId('get-your-guild-card')).not.toBeInTheDocument();
    });

    it('a viewer with no hub gets the prompt where the cards would be', async () => {
        serveOnboarding();
        server.use(http.get(MINE, () => HttpResponse.json({ guilds: [] } satisfies MyGuilds)));
        renderWithProviders(<PlayersGuildCard />);
        await screen.findByTestId('get-your-guild-card');
    });
});
