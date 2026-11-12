/**
 * ROK-1927 (W13) — the WoW: Forever "Attunements" Overview card: one row per
 * group with done/total + meter + muted note (F1), untracked greyed (AC8),
 * the nobody-has-data and partial/stale states (F5, AC9), the unverified
 * empty sentence, the error alert, the visitor probe (AC1), the "See who"
 * seam into the detail store, and the registration (order 90, span 1).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor, renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX, ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClientProvider } from '@tanstack/react-query';
import type { GuildPage, WowRosterAttunementsDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders, createTestQueryClient } from '../../../test/render-helpers';
import {
    ROSTER_INSIGHTS_URL, VISITOR_FIXTURE, createBareRosterInsights, rosterInsightsHandler,
} from '../../../test/handlers/forever-hub-widgets';
import {
    buildAttunementDef, buildAttunementMember, buildAttunementsSection, daysAgo,
} from '../../../test/factories/forever-attunements';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import AttunementsWidget from './attunements-widget';
import { AttunementsAction } from './attunements-action';
import { useAttunementsDetail } from './attunements-detail-store';
import { attunementsWidget, useAttunementsVisible } from './attunements.register';
import { ATTUNEMENTS_NO_DATA_COPY, ATTUNEMENTS_UNVERIFIED_COPY } from './attunements.helpers';
import { useRosterInsights } from './use-roster-insights';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

function ctx(): Pick<HubWidgetCtx, 'page'> {
    const page: GuildPage = {
        guild: { id: 7, gameId: 3, kind: 'wow_guild', name: 'Hub', region: 'us', realmSlug: null, realmName: null, faction: null,
            memberCount: 30, lastSnapshotAt: null, gameSlug: 'world-of-warcraft-forever' },
        importedBy: null,
        viewer: { role: 'member', canEdit: false, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
    return { page };
}

function serve(attunements: WowRosterAttunementsDto): void {
    server.use(rosterInsightsHandler({ all: createBareRosterInsights({ attunements }) }));
}

async function renderCard(attunements: WowRosterAttunementsDto): Promise<HTMLElement> {
    serve(attunements);
    renderWithProviders(<AttunementsWidget {...ctx()} />);
    return screen.findByTestId('attunements');
}

function row(groupKey: string): HTMLElement {
    return screen.getByTestId(`attunement-row-${groupKey}`);
}

beforeEach(() => useAttunementsDetail.setState({ guildId: null }));

describe('AttunementsWidget', () => {
    it('draws one row per group with done/total, the meter and the in-progress note (F1)', async () => {
        await renderCard(buildAttunementsSection());
        const mc = row('mc');
        expect(within(mc).getByText('Molten Core')).toBeInTheDocument();
        expect(within(mc).getByTestId('attunement-count')).toHaveTextContent('12/30 attuned');
        expect(within(mc).getByRole('meter')).toHaveAttribute('aria-valuenow', '40');
        expect(within(mc).getByTestId('attunement-note')).toHaveTextContent('6 in progress');
        expect(within(row('onyxia')).getByTestId('attunement-count')).toHaveTextContent('5/30');
        expect(screen.getAllByTestId(/^attunement-row-/)).toHaveLength(4);
    });

    it('greys an untracked group with its reason and no meter or count (AC8)', async () => {
        await renderCard(buildAttunementsSection());
        const naxx = row('naxx');
        expect(naxx).toHaveAttribute('data-tracked', 'false');
        expect(naxx).toHaveTextContent('Not tracked yet — needs reputation data');
        expect(within(naxx).queryByRole('meter')).toBeNull();
        expect(within(naxx).queryByTestId('attunement-count')).toBeNull();
    });

    it('says nobody has shared quest data, with 0/N rows and no per-row "without data" (F5a)', async () => {
        const allNoData = { done: 0, inProgress: 0, notStarted: 0, noData: 30 };
        await renderCard(buildAttunementsSection({
            attunements: [buildAttunementDef('mc', { counts: allNoData })], oldestAsOf: null,
            members: [buildAttunementMember({ asOf: null, source: null })],
        }));
        expect(screen.getByTestId('attunements-no-data')).toHaveTextContent(ATTUNEMENTS_NO_DATA_COPY);
        expect(within(row('mc')).getByTestId('attunement-count')).toHaveTextContent('0/30');
        expect(within(row('mc')).queryByTestId('attunement-note')).toBeNull();
    });

    it('notes members without data and turns the footer warning past 14 days (F5b, AC9)', async () => {
        const old = daysAgo(20);
        await renderCard(buildAttunementsSection({
            attunements: [buildAttunementDef('mc', { counts: { done: 3, inProgress: 1, notStarted: 5, noData: 21 } })],
            oldestAsOf: old, members: [buildAttunementMember({ asOf: old })],
        }));
        expect(within(row('mc')).getByTestId('attunement-note')).toHaveTextContent('1 in progress · 21 without data');
        expect(screen.queryByTestId('attunements-no-data')).toBeNull();
        const footer = screen.getByTestId('attunements-freshness');
        expect(footer).toHaveAttribute('data-stale', 'true');
        expect(footer).toHaveTextContent(/via LedgerLink · as of 20 days ago/);
    });

    it('shows the unverified sentence when the dataset has no confirmed attunement', async () => {
        serve(buildAttunementsSection({ attunements: [] }));
        renderWithProviders(<AttunementsWidget {...ctx()} />);
        expect(await screen.findByTestId('attunements-unverified')).toHaveTextContent(ATTUNEMENTS_UNVERIFIED_COPY);
        expect(screen.queryByTestId('attunements')).toBeNull();
    });

    it('announces a load failure', async () => {
        server.use(http.get(ROSTER_INSIGHTS_URL, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
        renderWithProviders(<AttunementsWidget {...ctx()} />);
        expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load attunements.");
    });
});

describe('Attunements visibility and the See who seam', () => {
    function wrapper({ children }: { children: ReactNode }): JSX.Element {
        return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
    }

    it('hides the card for a visitor payload (no attunements key, AC1)', async () => {
        server.use(rosterInsightsHandler({ all: VISITOR_FIXTURE }));
        const { result } = renderHook(() => ({
            visible: useAttunementsVisible(ctx()),
            data: useRosterInsights(ctx().page.guild.id, false).data,
        }), { wrapper });
        await waitFor(() => expect(result.current.data).toBeDefined());
        expect(result.current.visible).toBe(false);
    });

    it('shows the card for a member payload, even an unverified (empty) one', async () => {
        serve(buildAttunementsSection({ attunements: [] }));
        const { result } = renderHook(() => useAttunementsVisible(ctx()), { wrapper });
        await waitFor(() => expect(result.current).toBe(true));
    });

    it('"See who" opens the detail for this hub through the store', async () => {
        serve(buildAttunementsSection());
        renderWithProviders(<AttunementsAction {...ctx()} />);
        await userEvent.click(await screen.findByRole('button', { name: 'See who' }));
        expect(useAttunementsDetail.getState().guildId).toBe(7);
    });

    it('has no "See who" while nothing is verified', async () => {
        serve(buildAttunementsSection({ attunements: [] }));
        renderWithProviders(<><AttunementsAction {...ctx()} /><AttunementsWidget {...ctx()} /></>);
        await screen.findByTestId('attunements-unverified');
        expect(screen.queryByRole('button', { name: 'See who' })).toBeNull();
    });
});

describe('an all-untracked payload (S1)', () => {
    it('shows the §7 empty state and no "See who" when no group is trackable', async () => {
        serve(buildAttunementsSection({ attunements: [
            buildAttunementDef('naxx', { instance: 'Naxxramas', trackable: false, untrackedReason: 'needs reputation data' }),
        ] }));
        renderWithProviders(<><AttunementsAction {...ctx()} /><AttunementsWidget {...ctx()} /></>);
        const body = await screen.findByTestId(/^attunements(-unverified)?$/);
        expect(body, 'a lone untracked group is the unverified empty state, not a card').toHaveAttribute('data-testid', 'attunements-unverified');
        expect(screen.queryByRole('button', { name: 'See who' })).toBeNull();
    });
});

describe('attunementsWidget registration', () => {
    it('is the Forever guild "Attunements" card at order 90, span 1, with the See who action', () => {
        expect(attunementsWidget).toMatchObject({
            id: 'forever-attunements', title: 'Attunements', order: 90, span: 1, audience: 'everyone',
            games: ['world-of-warcraft-forever'], kinds: ['wow_guild'],
        });
        expect(attunementsWidget.action).toBe(AttunementsAction);
    });
});
