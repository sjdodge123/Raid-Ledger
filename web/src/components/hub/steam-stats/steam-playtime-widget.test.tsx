/** ROK-1953 — the Core Playtime card: hours rows, footnote, loading, viewer line. */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { hubSteamStatsHandler, steamMember, steamStatsResponse } from '../../../test/mocks/hub-steam-stats-handlers';
import SteamPlaytimeWidget from './steam-playtime-widget';
import { steamCtx } from './steam-stats.test-utils';

vi.mock('../../../hooks/use-steam-link', () => ({ useSteamLink: () => ({ linkSteam: vi.fn(), isLinkPending: false }) }));

async function renderCard(): Promise<HTMLElement> {
    const { container } = renderWithProviders(<SteamPlaytimeWidget {...steamCtx()} />);
    await waitFor(() => expect(screen.queryByTestId('steam-stats-loading')).toBeNull());
    return container;
}

describe('SteamPlaytimeWidget', () => {
    it('shows the three-row skeleton while loading', () => {
        server.use(hubSteamStatsHandler(steamStatsResponse()));
        renderWithProviders(<SteamPlaytimeWidget {...steamCtx()} />);
        expect(screen.getByTestId('steam-stats-loading').children).toHaveLength(3);
    });

    it('lists hours most first (private members keep library playtime), meter scaled to the top', async () => {
        server.use(hubSteamStatsHandler(steamStatsResponse()));
        await renderCard();
        expect(screen.getAllByTestId('steam-playtime-row').map((r) => r.textContent))
            .toEqual(['AAstarion Fan121 h', 'KKarlach Tav40 h', 'SShadowheart10 h']); // leading letter = avatar initials
        expect(screen.getByRole('meter', { name: 'Karlach Tav: 40 h' }).getAttribute('aria-valuenow')).toBe('33');
        expect(screen.getByTestId('steam-playtime-footnote').textContent).toBe("Lifetime Steam hours, all playthroughs · 1 hasn't linked Steam.");
    });

    it('nobody linked → the §4.5 sentence; a linked-but-unlinked-list viewer gets no button', async () => {
        server.use(hubSteamStatsHandler(steamStatsResponse({ members: [steamMember(1, { status: 'unlinked' })] })));
        await renderCard();
        expect(screen.getByTestId('steam-stats-empty').textContent).toBe('No one here has linked Steam yet.');
        expect(screen.queryByRole('button', { name: 'Link Steam' })).toBeNull();
    });

    it('viewer unlinked → "Link Steam to add your hours."', async () => {
        server.use(hubSteamStatsHandler(steamStatsResponse({ viewer: { status: 'unlinked' } })));
        await renderCard();
        expect(screen.getByTestId('steam-stats-callout').textContent).toContain('Link Steam to add your hours.');
    });
});
