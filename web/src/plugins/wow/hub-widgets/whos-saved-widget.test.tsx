/**
 * ROK-1914 (W6) — the WoW: Forever "Who's saved" widget. The live clock
 * (`useNowTick`) is replaced by a hoisted, test-driven `now` so expiry while
 * the card is open can be proved by advancing it and re-rendering.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor, renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX, ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { GuildPage, WowRosterInsightsDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders, createTestQueryClient } from '../../../test/render-helpers';
import {
    MOCK_CHAR_IDS, VISITOR_FIXTURE, createBareRosterInsights, rosterInsightsHandler,
} from '../../../test/handlers/forever-hub-widgets';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import WhosSavedWidget from './whos-saved-widget';
import { useWhosSavedVisible } from './whos-saved.register';

const clock = vi.hoisted(() => ({ now: 0 }));

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

vi.mock('../../../hooks/use-now-tick', () => ({ useNowTick: () => clock.now }));

const NOW = Date.parse('2026-11-01T00:00:00.000Z');
const HOUR = 3_600_000;
const at = (offsetMs: number): string => new Date(NOW + offsetMs).toISOString();
const WREN_ID = '44444444-4444-4444-8444-444444444444';

/** Molten Core (two members, one cleared), Onyxia (no difficulty label), BWL (two resets), ZG (expired). */
const LOCKOUTS_FIXTURE: WowRosterInsightsDto = createBareRosterInsights({
    freshness: { roster: { source: 'addon', asOf: at(-HOUR) }, characters: { addon: 3, blizzard: 0, none: 2 } },
    lockouts: [
        { instanceId: 409, difficultyId: 9, name: 'Molten Core', difficulty: '40 Player', total: 10, resetAt: at(3 * 24 * HOUR + 15 * HOUR),
            members: [
                { characterId: MOCK_CHAR_IDS.thrall, name: 'Ana', killed: 4, resetAt: at(3 * 24 * HOUR + 15 * HOUR) },
                { characterId: WREN_ID, name: 'Wren', killed: 10, resetAt: at(3 * 24 * HOUR + 15 * HOUR) },
            ] },
        { instanceId: 469, difficultyId: 9, name: 'Blackwing Lair', difficulty: '40 Player', total: 8, resetAt: at(HOUR),
            members: [
                { characterId: MOCK_CHAR_IDS.jaina, name: 'Jaina', killed: 2, resetAt: at(HOUR) },
                { characterId: MOCK_CHAR_IDS.mine, name: 'Mira', killed: 8, resetAt: at(2 * 24 * HOUR) },
            ] },
        { instanceId: 249, difficultyId: 99, name: 'Onyxia', difficulty: null, total: 1, resetAt: at(30 * 60_000),
            members: [{ characterId: WREN_ID, name: 'Wren', killed: 1, resetAt: at(30 * 60_000) }] },
        { instanceId: 309, difficultyId: 148, name: "Zul'Gurub", difficulty: '20 Player', total: 10, resetAt: at(-HOUR),
            members: [{ characterId: MOCK_CHAR_IDS.thrall, name: 'Ana', killed: 3, resetAt: at(-HOUR) }] },
    ],
});

const EMPTY_FIXTURE: WowRosterInsightsDto = { ...LOCKOUTS_FIXTURE, lockouts: [] };

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

function renderWidget(): ReturnType<typeof renderWithProviders> {
    return renderWithProviders(<WhosSavedWidget {...ctx()} />);
}

function row(name: RegExp): HTMLElement {
    return screen.getByRole('button', { name });
}

beforeEach(() => {
    clock.now = NOW;
});

describe('WhosSavedWidget', () => {
    it('lists each live instance with difficulty, saved count and reset countdown', async () => {
        server.use(rosterInsightsHandler({ all: LOCKOUTS_FIXTURE }));
        renderWidget();
        const mc = await screen.findByRole('button', { name: /Molten Core/ });
        expect(mc).toHaveTextContent('2 saved');
        expect(mc).toHaveTextContent('40 Player · Resets in 3d 15h');
        expect(row(/Onyxia/)).toHaveTextContent('1 saved');
        expect(row(/Onyxia/)).toHaveTextContent(/^Onyxia1 savedResets in 30m$/);
        const list = screen.getByRole('list', { name: 'Saved instances' });
        expect(within(list).getAllByRole('button').map((b) => b.textContent?.split(/\d/)[0])).toEqual(['Molten Core', 'Blackwing Lair', 'Onyxia']);
    });

    it('drops a lockout the cached payload still carries once its reset has passed', async () => {
        server.use(rosterInsightsHandler({ all: LOCKOUTS_FIXTURE }));
        renderWidget();
        await screen.findByRole('button', { name: /Molten Core/ });
        expect(screen.queryByRole('button', { name: /Zul'Gurub/ })).toBeNull();
    });

    it('expands an instance to its saved members, linked by character uuid, with kills', async () => {
        server.use(rosterInsightsHandler({ all: LOCKOUTS_FIXTURE }));
        renderWidget();
        const mc = await screen.findByRole('button', { name: /Molten Core/ });
        expect(mc).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('link', { name: 'Ana' })).toBeNull();
        await userEvent.click(mc);
        expect(mc).toHaveAttribute('aria-expanded', 'true');
        const list = screen.getByRole('list', { name: 'Molten Core saved members' });
        expect(within(list).getByRole('link', { name: 'Ana' })).toHaveAttribute('href', `/characters/${MOCK_CHAR_IDS.thrall}`);
        expect(within(list).getByRole('link', { name: 'Wren' })).toHaveAttribute('href', `/characters/${WREN_ID}`);
        const kills = within(list).getAllByTestId('whos-saved-kills');
        expect(kills.map((k) => k.textContent)).toEqual(['4/10', '10/10']);
        expect(kills[0]).toHaveClass('text-foreground');
        expect(kills[1]).toHaveClass('text-success');
    });

    it("shows a member's own countdown only when it differs from the group's soonest reset", async () => {
        server.use(rosterInsightsHandler({ all: LOCKOUTS_FIXTURE }));
        renderWidget();
        await userEvent.click(await screen.findByRole('button', { name: /Blackwing Lair/ }));
        expect(row(/Blackwing Lair/)).toHaveTextContent('Resets in 1h');
        const list = screen.getByRole('list', { name: 'Blackwing Lair saved members' });
        const [jaina, mira] = within(list).getAllByRole('listitem');
        expect(jaina).not.toHaveTextContent('Resets in');
        expect(mira).toHaveTextContent('Resets in 2d 0h');
    });

    it('drops a member whose reset passes while open, then the group, then shows the empty state', async () => {
        server.use(rosterInsightsHandler({ all: LOCKOUTS_FIXTURE }));
        const view = renderWidget();
        await userEvent.click(await screen.findByRole('button', { name: /Blackwing Lair/ }));
        clock.now = NOW + HOUR + 1;
        view.rerender(<WhosSavedWidget {...ctx()} />);
        const list = screen.getByRole('list', { name: 'Blackwing Lair saved members' });
        expect(within(list).queryByRole('link', { name: 'Jaina' })).toBeNull();
        expect(within(list).getByRole('link', { name: 'Mira' })).toBeInTheDocument();
        expect(row(/Blackwing Lair/)).toHaveTextContent('1 saved');
        expect(row(/Blackwing Lair/)).toHaveTextContent('Resets in 1d 22h');
        expect(screen.queryByRole('button', { name: /Onyxia/ })).toBeNull();
        clock.now = NOW + 5 * 24 * HOUR;
        view.rerender(<WhosSavedWidget {...ctx()} />);
        expect(screen.queryByRole('list', { name: 'Saved instances' })).toBeNull();
        expect(screen.getByTestId('whos-saved-empty')).toHaveTextContent('No one is saved to an instance right now.');
    });

    it('shows the empty state with the reporting line when no one is saved', async () => {
        server.use(rosterInsightsHandler({ all: EMPTY_FIXTURE }));
        renderWidget();
        const empty = await screen.findByTestId('whos-saved-empty');
        expect(empty).toHaveTextContent('No one is saved to an instance right now.');
        expect(screen.getByTestId('whos-saved-footer')).toHaveTextContent(/^Based on 3 members' addon exports$/);
    });

    it('says "1 member\'s addon export" (singular) when one member reports', async () => {
        const one = { ...EMPTY_FIXTURE, freshness: { ...EMPTY_FIXTURE.freshness, characters: { addon: 1, blizzard: 0, none: 0 } } };
        server.use(rosterInsightsHandler({ all: one }));
        renderWidget();
        expect(await screen.findByTestId('whos-saved-footer')).toHaveTextContent(/^Based on 1 member's addon export$/);
    });

    it('asks for the full roster, never mains only', async () => {
        const urls: URL[] = [];
        server.use(rosterInsightsHandler({ all: LOCKOUTS_FIXTURE, onRequest: (u) => urls.push(u) }));
        renderWidget();
        await screen.findByRole('button', { name: /Molten Core/ });
        expect(urls.map((u) => u.searchParams.get('mainsOnly'))).toEqual([null]);
    });
});

describe('useWhosSavedVisible', () => {
    function wrapper({ children }: { children: ReactNode }): JSX.Element {
        return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
    }

    it('hides the card for a visitor payload (no lockouts key)', async () => {
        let served = false;
        server.use(rosterInsightsHandler({ all: VISITOR_FIXTURE, onRequest: () => { served = true; } }));
        const { result } = renderHook(() => useWhosSavedVisible(ctx()), { wrapper });
        await waitFor(() => expect(served).toBe(true));
        await waitFor(() => expect(result.current).toBe(false));
    });

    it('shows the card (empty state) when lockouts is an empty array', async () => {
        server.use(rosterInsightsHandler({ all: EMPTY_FIXTURE }));
        const { result } = renderHook(() => useWhosSavedVisible(ctx()), { wrapper });
        await waitFor(() => expect(result.current).toBe(true));
    });
});
