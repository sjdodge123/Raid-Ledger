/**
 * ROK-1786 (S2): the Players guild card shows the GM post headline, and the
 * character page's guild addons card shows only for an openable guild.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { CharacterGuild, MyGuild } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { PlayersGuildCard } from './players-guild-card';
import { CharacterAddonsCard } from './character-addons-card';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const API = 'http://localhost:3000/plugins/wow/guilds';
const CHAR_ID = '5b3c6f3e-1d2a-4c9b-9a51-2f8e7d6c5b4a';
const SUMMARY = { id: 11, gameId: 7, kind: 'wow_guild' as const, name: 'Iron Vanguard', region: 'us', realmSlug: 'whitemane', realmName: null, faction: 'horde', memberCount: 12, lastSnapshotAt: null };

function mine(gmPostHeadline: string | null): MyGuild {
    return { ...SUMMARY, rankIndex: 2, rankName: 'Raider', canEdit: false, gmPostHeadline };
}

function serveCharacter(data: CharacterGuild['data']): { addonCalls: () => number } {
    let hits = 0;
    server.use(
        http.get(`${API}/by-character/${CHAR_ID}`, () => HttpResponse.json({ data })),
        http.get(`${API}/11/addons`, () => {
            hits += 1;
            return HttpResponse.json({ pinned: [{ name: 'LedgerLink', url: 'https://github.com/sjdodge123/ledger-link', note: null, requirement: 'required', flavors: [] }], addons: [] });
        }),
    );
    return { addonCalls: () => hits };
}

describe('PlayersGuildCard — GM post headline', () => {
    it('shows the headline under the guild name', async () => {
        server.use(http.get(`${API}/mine`, () => HttpResponse.json({ guilds: [mine('Raid Thursday 8pm')] })));
        renderWithProviders(<PlayersGuildCard />);
        expect(await screen.findByTestId('players-guild-headline')).toHaveTextContent('Raid Thursday 8pm');
    });

    it('shows no headline line when there is no post', async () => {
        server.use(http.get(`${API}/mine`, () => HttpResponse.json({ guilds: [mine(null)] })));
        renderWithProviders(<PlayersGuildCard />);
        await screen.findByTestId('players-guild-card');
        expect(screen.queryByTestId('players-guild-headline')).toBeNull();
    });
});

describe('CharacterAddonsCard — gating', () => {
    it('shows the guild addons when the viewer can open the guild', async () => {
        serveCharacter({ guild: SUMMARY, rankName: 'Raider', viewerCanOpen: true });
        renderWithProviders(<CharacterAddonsCard characterId={CHAR_ID} />);
        const card = await screen.findByTestId('character-guild-addons');
        expect(card).toHaveTextContent('LedgerLink');
        expect(card).toHaveTextContent('Required');
    });

    it('renders nothing and never fetches addons when the viewer cannot open the guild', async () => {
        const s = serveCharacter({ guild: SUMMARY, rankName: 'Raider', viewerCanOpen: false });
        let seen = false;
        server.events.on('response:mocked', ({ request }) => { if (request.url.includes('by-character')) seen = true; });
        const { container } = renderWithProviders(<CharacterAddonsCard characterId={CHAR_ID} />);
        await waitFor(() => expect(seen, 'the by-character request must settle first').toBe(true));
        await new Promise((r) => setTimeout(r, 0));
        expect(container.innerHTML).toBe('');
        expect(s.addonCalls(), 'no addons fetch for an unopenable guild').toBe(0);
        server.events.removeAllListeners();
    });
});
