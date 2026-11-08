/** ROK-2148 T23/T24 — the Forever "Guild contributions" card: sections, toggle, empty states, probe. */
import { describe, expect, it } from 'vitest';
import { fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { GuildContributionsDto, GuildPage } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient, renderWithProviders } from '../../../test/render-helpers';
import {
    buildEmptyContributions, buildGiver, buildMaster, buildUser, guildContributionsGetHandler,
} from '../../../test/mocks/guild-contributions-handlers';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { guildContributionsKey, useContributionsVisible } from '../hooks/use-guild-contributions';
import ContributionsWidget from './contributions-widget';
import {
    GIVERS_EMPTY_30, GIVERS_EMPTY_ALL, GIVERS_EMPTY_HINT, MASTERS_EMPTY, USERS_EMPTY,
} from './contributions.helpers';

function must<T>(x: T | undefined, label: string): T {
    if (x === undefined) throw new Error(`missing ${label}`);
    return x;
}

const LINKED = '22222222-2222-4222-8222-222222222222';

function ctx(): HubWidgetCtx {
    const page = {
        guild: { id: 5, kind: 'wow_guild', gameSlug: WOW_FOREVER_GAME_SLUG },
        viewer: { role: 'member', canEdit: false, canManageEditors: false },
    } as GuildPage;
    // The card reads only `page.guild.id`; access comes from the read (guild-text test idiom).
    return { page, gameSlug: WOW_FOREVER_GAME_SLUG } as HubWidgetCtx;
}

function fullDto(): GuildContributionsDto {
    const dto = buildEmptyContributions();
    return {
        template: { rev: '2026-11-02T12:00:00.000Z', authorName: 'Thessaly', authorCharacterId: null },
        masters: [
            buildMaster({ characterId: LINKED }),
            buildMaster({ professionSkillLineId: 202, profession: 'Engineering', title: 'Guild Engineer', recipientName: 'Fizzwick', characterId: null, onRoster: false }),
        ],
        givers: {
            ...dto.givers,
            last30Days: [buildGiver({ items: 142 }), buildGiver({ rank: 2, characterName: 'Morwenna', items: 118 })],
            allTime: [buildGiver({ characterName: 'Morwenna', items: 1284 })],
            youLast30Days: buildGiver({ rank: 14, characterName: 'Brannoc', items: 3, isYou: true }),
            last30DaysTotal: 611, allTimeTotal: 7452,
            countingSince: '2026-08-14T12:00:00.000Z', asOf: '2026-11-08T10:00:00.000Z',
        },
        users: Array.from({ length: 14 }, (_, i) => buildUser(`Player${String(i + 1).padStart(2, '0')}`)),
    };
}

function serve(body: GuildContributionsDto | 'forbidden'): void { server.use(guildContributionsGetHandler(body)); }

async function renderCard(body: GuildContributionsDto): Promise<HTMLElement> {
    serve(body);
    renderWithProviders(<ContributionsWidget {...ctx()} />);
    return screen.findByTestId('contributions-card');
}

describe('ContributionsWidget (T23)', () => {
    it('renders masters linked when on the roster, plain + "not on roster" when not', async () => {
        await renderCard(fullDto());
        const rows = screen.getAllByTestId('contributions-master-row');
        expect(rows).toHaveLength(2);
        const linked = within(must(rows[0], 'linked master row'));
        const offRoster = within(must(rows[1], 'off-roster master row'));
        expect(linked.getByText('Guild Enchanter')).toBeInTheDocument();
        expect(linked.getByTestId('guild-member-link')).toHaveAttribute('href', `/characters/${LINKED}`);
        expect(offRoster.getByTestId('guild-member-unlinked')).toHaveTextContent('Fizzwick');
        expect(offRoster.getByText('not on roster')).toBeInTheDocument();
        expect(screen.getByTestId('contributions-template')).toHaveTextContent('Guild template by Thessaly · revised 2 Nov 2026');
    });

    it('shows 30-day givers with the guild total and the viewer row, then All time on toggle', async () => {
        await renderCard(fullDto());
        expect(screen.getByTestId('contributions-givers-total')).toHaveTextContent('611 items given this month');
        expect(screen.getAllByTestId('contributions-giver-row').map((r) => within(r).getByTestId('contributions-giver-items').textContent))
            .toEqual(['142 items', '118 items']);
        const you = screen.getByTestId('contributions-giver-you');
        expect(you).toHaveTextContent('Brannoc');
        expect(within(you).getByText('You')).toBeInTheDocument();
        expect(within(you).getByTestId('contributions-rank')).toHaveAttribute('data-rank', '14');

        fireEvent.click(screen.getByRole('radio', { name: 'All time' }));
        expect(screen.getByTestId('contributions-givers-total')).toHaveTextContent('7,452 items given since 14 Aug 2026');
        expect(screen.getAllByTestId('contributions-giver-row').map((r) => within(r).getByTestId('contributions-giver-items').textContent))
            .toEqual(['1,284 items']);
        expect(screen.queryByTestId('contributions-giver-you')).not.toBeInTheDocument();
    });

    it('scales each meter to the top giver', async () => {
        await renderCard(fullDto());
        const meters = within(screen.getByTestId('contributions-givers')).getAllByRole('meter');
        expect(meters.map((m) => m.getAttribute('aria-valuenow'))).toEqual(['100', '83', '2']);
        expect(meters[1]).toHaveAttribute('aria-label', 'Morwenna: 118 items');
    });

    it('lists the first 12 users and "Show all 14" expands in place', async () => {
        await renderCard(fullDto());
        expect(screen.getByTestId('contributions-users-count')).toHaveTextContent('14 members run Mailworthy');
        expect(screen.getAllByTestId('contributions-user')).toHaveLength(12);
        fireEvent.click(screen.getByTestId('contributions-users-show-all'));
        expect(screen.getAllByTestId('contributions-user')).toHaveLength(14);
        expect(screen.queryByTestId('contributions-users-show-all')).not.toBeInTheDocument();
    });

    it('renders every encouraging empty state (no template, no givers, no users)', async () => {
        await renderCard(buildEmptyContributions());
        expect(screen.getByTestId('contributions-masters-empty')).toHaveTextContent(MASTERS_EMPTY);
        const givers = screen.getByTestId('contributions-givers-empty');
        expect(givers).toHaveTextContent(GIVERS_EMPTY_30);
        expect(givers).toHaveTextContent(GIVERS_EMPTY_HINT);
        expect(screen.getByTestId('contributions-users-empty')).toHaveTextContent(USERS_EMPTY);
        fireEvent.click(screen.getByRole('radio', { name: 'All time' }));
        expect(screen.getByTestId('contributions-givers-empty')).toHaveTextContent(GIVERS_EMPTY_ALL);
    });

    it('shows the LedgerLink freshness line', async () => {
        await renderCard(fullDto());
        expect(screen.getByTestId('contributions-freshness')).toHaveTextContent(/^via LedgerLink · as of /);
    });
});

function probe() {
    const client = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const hook = renderHook(() => useContributionsVisible(ctx()), { wrapper });
    // Settled = the GET answered (success or a refused 403), so `false` is final, not "still loading".
    const settled = () => waitFor(() => expect(client.getQueryState(guildContributionsKey(5))?.status).not.toBe('pending'));
    return { ...hook, settled };
}

describe('useContributionsVisible (T24)', () => {
    it('is false on a 403 (visitor)', async () => {
        serve('forbidden');
        const { result, settled } = probe();
        await settled();
        expect(result.current).toBe(false);
    });

    it('is true on a 200, even for an empty DTO', async () => {
        serve(buildEmptyContributions());
        const { result } = probe();
        await waitFor(() => expect(result.current).toBe(true));
    });
});
