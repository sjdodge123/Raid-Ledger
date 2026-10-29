/**
 * ROK-1915 (W7 + W8) — the WoW: Forever "Gear readiness" hub widget: the
 * item-level histogram + "Median N · floor F", the collapsed "Below floor" and
 * "Missing enchants" disclosures (CharacterLink names, slot names), the
 * "N unknown" line for schema-1 exports, the AC6 empty state, the visitor
 * probe and the registration (id, order, audience, action).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, within, waitFor, renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX, ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { GuildPage, WowRosterGearDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders, createTestQueryClient } from '../../../test/render-helpers';
import {
    MOCK_CHAR_IDS, VISITOR_FIXTURE, createBareRosterInsights, rosterInsightsHandler,
} from '../../../test/handlers/forever-hub-widgets';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import GearReadinessWidget from './gear-readiness-widget';
import { gearReadinessWidget, useGearReadinessVisible } from './gear-readiness.register';
import { MembersSeeAll } from './see-all-actions';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const BUCKETS: WowRosterGearDto['ilvl']['buckets'] = [
    { from: 0, to: 44, count: 1 }, { from: 45, to: 49, count: 2 }, { from: 50, to: 54, count: 4 },
    { from: 55, to: 59, count: 8 }, { from: 60, to: 64, count: 5 }, { from: 65, to: 999, count: 0 },
];

const POPULATED: WowRosterGearDto = {
    ilvl: {
        buckets: BUCKETS, median: 56, floor: 55, belowCount: 7, reporters: 20, levelling: 3,
        below: [
            { name: 'Brannoch', characterId: MOCK_CHAR_IDS.thrall, ilvl: 41 },
            { name: 'Elsweyr', characterId: MOCK_CHAR_IDS.jaina, ilvl: 47 },
        ],
    },
    enchants: {
        checked: 17, unknown: 2, missingCount: 2,
        missing: [
            { name: 'Brannoch', characterId: MOCK_CHAR_IDS.thrall, slots: [8, 9] },
            { name: 'Mirelle', characterId: MOCK_CHAR_IDS.mine, slots: [15] },
        ],
    },
    freshness: { source: 'addon', asOf: new Date(Date.now() - 2 * 86_400_000).toISOString() },
};

const EMPTY: WowRosterGearDto = {
    ilvl: { buckets: [], median: null, floor: 55, belowCount: 0, below: [], reporters: 0, levelling: 0 },
    enchants: { checked: 0, unknown: 0, missingCount: 0, missing: [] },
    freshness: null,
};

function ctx(): Pick<HubWidgetCtx, 'page'> {
    const page: GuildPage = {
        guild: { id: 7, gameId: 3, kind: 'wow_guild', name: 'Hub', region: 'us', realmSlug: null, realmName: null, faction: null,
            memberCount: 42, lastSnapshotAt: null, gameSlug: 'world-of-warcraft-forever' },
        importedBy: null,
        viewer: { role: 'member', canEdit: false, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
    return { page };
}

async function renderWith(gear: WowRosterGearDto): Promise<void> {
    server.use(rosterInsightsHandler({ all: createBareRosterInsights({ gear }) }));
    renderWithProviders(<GearReadinessWidget {...ctx()} />);
    await screen.findByTestId('forever-freshness');
}

describe('GearReadinessWidget', () => {
    it('draws the item-level histogram with the open-ended end labels and the median line', async () => {
        await renderWith(POPULATED);
        const hist = screen.getByRole('group', { name: 'Level 60 mains per item-level range' });
        const bars = within(hist).getAllByRole('link');
        expect(bars).toHaveLength(6);
        expect(bars[0]).toHaveAccessibleName('Item level below 45: 1 main');
        expect(bars[0]).toHaveTextContent('<45');
        expect(bars[2]).toHaveAccessibleName('Item level 50–54: 4 mains');
        expect(bars[5]).toHaveTextContent('65+');
        expect(bars[5]).toHaveAccessibleName('Item level 65 and above: 0 mains');
        expect(screen.getByTestId('gear-meta')).toHaveTextContent('Median 56 · floor 55 · 3 levelling mains not counted');
        expect(screen.getByTestId('forever-freshness')).toHaveTextContent('via LedgerLink · as of 2 days ago');
    });

    it('keeps "Below floor" collapsed, then lists linked names with item levels and "+N more"', async () => {
        await renderWith(POPULATED);
        const toggle = screen.getByRole('button', { name: /Below floor \(55\)/ });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(toggle).toHaveClass('min-h-11');
        expect(screen.queryByRole('list', { name: 'Mains below the item-level floor' })).toBeNull();
        await userEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        const list = screen.getByRole('list', { name: 'Mains below the item-level floor' });
        const rows = within(list).getAllByRole('listitem');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toHaveTextContent('41');
        expect(rows[0]).toHaveClass('min-h-11');
        expect(within(list).getByRole('link', { name: 'Brannoch' })).toHaveAttribute('href', `/characters/${MOCK_CHAR_IDS.thrall}`);
        expect(screen.getByText('+5 more')).toBeInTheDocument();
    });

    it('lists missing enchants per main with slot names behind a collapsed disclosure', async () => {
        await renderWith(POPULATED);
        const toggle = screen.getByRole('button', { name: /2 of 17 checked mains/ });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await userEvent.click(toggle);
        const list = screen.getByRole('list', { name: 'Mains missing enchants' });
        const rows = within(list).getAllByRole('listitem');
        expect(rows[0]).toHaveTextContent('Feet, Wrist');
        expect(rows[1]).toHaveTextContent('Back');
        expect(within(list).getByRole('link', { name: 'Mirelle' })).toHaveAttribute('href', `/characters/${MOCK_CHAR_IDS.mine}`);
    });

    it('counts schema-1 exports as unknown, with the re-export hint', async () => {
        await renderWith(POPULATED);
        expect(screen.getByTestId('gear-unknown')).toHaveTextContent('2 unknown — re-export from LedgerLink to check enchants.');
    });
});

describe('GearReadinessWidget sparse states', () => {
    it('shows the unknown line alone when no main has a schema-2 export yet', async () => {
        await renderWith({ ...EMPTY, enchants: { ...EMPTY.enchants, unknown: 1 } });
        expect(screen.getByTestId('gear-unknown')).toHaveTextContent('1 unknown — re-export from LedgerLink to check enchants.');
        expect(screen.queryByTestId('gear-readiness-empty')).toBeNull();
        expect(screen.queryByTestId('gear-missing-enchants')).toBeNull();
    });

    it('says nothing is missing instead of an empty disclosure when every checked main is enchanted', async () => {
        await renderWith({ ...POPULATED, enchants: { checked: 4, unknown: 0, missingCount: 0, missing: [] } });
        expect(screen.getByText('No missing enchants among 4 checked mains.')).toBeInTheDocument();
        expect(screen.queryByTestId('gear-missing-enchants')).toBeNull();
        expect(screen.queryByTestId('gear-unknown')).toBeNull();
    });

    it('shows the AC6 empty state, with no histogram, before any gear is reported', async () => {
        await renderWith(EMPTY);
        expect(screen.getByTestId('gear-readiness-empty'))
            .toHaveTextContent("No gear yet — each player's LedgerLink character export fills this card.");
        expect(screen.queryByRole('group', { name: 'Level 60 mains per item-level range' })).toBeNull();
        expect(screen.getByTestId('forever-freshness')).toHaveTextContent(/^via LedgerLink$/);
    });
});

describe('useGearReadinessVisible', () => {
    function wrapper({ children }: { children: ReactNode }): JSX.Element {
        return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
    }

    it('hides the card for a visitor payload (no gear key)', async () => {
        let served = false;
        server.use(rosterInsightsHandler({ all: VISITOR_FIXTURE, onRequest: () => { served = true; } }));
        const { result } = renderHook(() => useGearReadinessVisible(ctx()), { wrapper });
        await waitFor(() => expect(served).toBe(true));
        await waitFor(() => expect(result.current).toBe(false));
    });

    it('shows the card for a member payload, even before any gear is reported', async () => {
        server.use(rosterInsightsHandler({ all: createBareRosterInsights({ gear: EMPTY }) }));
        const { result } = renderHook(() => useGearReadinessVisible(ctx()), { wrapper });
        await waitFor(() => expect(result.current).toBe(true));
    });
});

describe('gearReadinessWidget registration', () => {
    it('is the Forever guild "Gear readiness" card at order 88 with the Members see-all action', () => {
        expect(gearReadinessWidget).toMatchObject({
            id: 'forever-gear-readiness', title: 'Gear readiness', order: 88, span: 1, audience: 'everyone',
            games: ['world-of-warcraft-forever'], kinds: ['wow_guild'],
        });
        expect(gearReadinessWidget.action).toBe(MembersSeeAll);
    });
});
