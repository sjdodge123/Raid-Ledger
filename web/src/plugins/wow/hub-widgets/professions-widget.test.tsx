/**
 * ROK-1923 (epic ROK-1905 H8) — the WoW: Forever Guild professions widget (W4).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, within, waitFor, renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX, ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { GuildPage } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders, createTestQueryClient } from '../../../test/render-helpers';
import {
    MY_CHAR_ID, NO_PROFESSIONS_FIXTURE, PROF_CHAR_A, PROF_CHAR_B, PROFESSIONS_FIXTURE, VISITOR_FIXTURE,
    foreverCharacter, myCharactersHandler, rosterInsightsHandler,
} from '../../../test/mocks/roster-insights-professions-handlers';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import ProfessionsWidget from './professions-widget';
import { useProfessionsVisible } from './professions.register';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

function ctx(): Pick<HubWidgetCtx, 'page'> {
    const page: GuildPage = {
        guild: { id: 7, gameId: 3, kind: 'wow_guild', name: 'Hub', region: 'us', realmSlug: null, realmName: null, faction: null,
            memberCount: 5, lastSnapshotAt: null, gameSlug: 'world-of-warcraft-forever' },
        importedBy: null,
        viewer: { role: 'member', canEdit: false, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
    return { page };
}

function renderWidget(): void {
    renderWithProviders(<ProfessionsWidget {...ctx()} />);
}

describe('ProfessionsWidget', () => {
    it('lists each profession with its member count and best known skill', async () => {
        server.use(rosterInsightsHandler(PROFESSIONS_FIXTURE));
        renderWidget();
        const alchemy = await screen.findByRole('button', { name: /Alchemy/ });
        expect(alchemy).toHaveTextContent('2 members');
        expect(alchemy).toHaveTextContent('225/300');
        expect(screen.getByRole('button', { name: /Mining/ })).toHaveTextContent('1 member');
        expect(screen.getByRole('button', { name: /Mining/ })).toHaveTextContent('150/150');
    });

    it('expands a profession to its members, each linking to their character by uuid', async () => {
        server.use(rosterInsightsHandler(PROFESSIONS_FIXTURE));
        renderWidget();
        const alchemy = await screen.findByRole('button', { name: /Alchemy/ });
        expect(alchemy).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('link', { name: 'Brewa' })).toBeNull();
        await userEvent.click(alchemy);
        expect(alchemy).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('link', { name: 'Brewa' })).toHaveAttribute('href', `/characters/${PROF_CHAR_A}`);
        expect(screen.getByRole('link', { name: 'Mixer' })).toHaveAttribute('href', `/characters/${PROF_CHAR_B}`);
        const list = screen.getByRole('list', { name: 'Alchemy members' });
        expect(within(list).getByText('225/300')).toBeInTheDocument();
        expect(within(list).getByText('manual')).toBeInTheDocument();
        expect(within(list).getByText('addon')).toBeInTheDocument();
    });

    it('shows a freshness footer', async () => {
        server.use(rosterInsightsHandler(PROFESSIONS_FIXTURE));
        renderWidget();
        expect(await screen.findByTestId('professions-footer')).toHaveTextContent('2 characters with professions');
    });

    it('invites the viewer to set professions on their own Forever character when none are set', async () => {
        server.use(rosterInsightsHandler(NO_PROFESSIONS_FIXTURE),
            myCharactersHandler([foreverCharacter(MY_CHAR_ID, 3)]));
        renderWidget();
        expect(await screen.findByText(/No one has set their professions yet/)).toBeInTheDocument();
        const link = await screen.findByRole('link', { name: 'Set your professions' });
        expect(link).toHaveAttribute('href', `/characters/${MY_CHAR_ID}`);
    });

    it('explains how to add professions when the viewer has no Forever character', async () => {
        server.use(rosterInsightsHandler(NO_PROFESSIONS_FIXTURE), myCharactersHandler([]));
        renderWidget();
        expect(await screen.findByText(/add them from their character page/)).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Set your professions' })).toBeNull();
    });
});

describe('useProfessionsVisible', () => {
    function wrapper({ children }: { children: ReactNode }): JSX.Element {
        return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
    }

    it('hides the card for a visitor payload (no professions key)', async () => {
        server.use(rosterInsightsHandler(VISITOR_FIXTURE));
        const { result } = renderHook(() => useProfessionsVisible(ctx()), { wrapper });
        await waitFor(() => expect(result.current).toBe(false));
    });

    it('shows the card (empty state) when professions is an empty array', async () => {
        server.use(rosterInsightsHandler(NO_PROFESSIONS_FIXTURE));
        const { result } = renderHook(() => useProfessionsVisible(ctx()), { wrapper });
        await waitFor(() => expect(result.current).toBe(true));
    });
});
