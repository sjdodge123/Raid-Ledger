/**
 * ROK-2151 — a staff viewer who is not a member of a claimable WoW: Forever
 * guild hub gets the "Claim your character" banner on Overview (the real
 * GuildPage, 200). The Add character modal is stubbed to its props, as in the
 * join gate's test: ROK-2149 owns its tabs and filter.
 *
 * "No banner" cases pre-seed the join-gate answer, so the widget probe decides
 * in the same render as the rest of the Overview grid: an absent banner once
 * the grid exists means "not shown", never "still loading".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import type { JSX } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { GuildPage as GuildPageDto, WowGuildJoinGateDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient, renderWithProviders } from '../../../test/render-helpers';
import { activateWowPlugin } from '../../../test/activate-wow-plugin';
import { GuildPage } from '../../../components/hub/hub-page';
import { usePluginStore } from '../../../stores/plugin-store';
import { NOT_LINKED_WARNING } from './wow-join-gate.helpers';
import { joinGateKey } from './use-join-gate';
import { CLAIM_BANNER_COPY } from './wow-claim-banner.helpers';

const VIEWER = 1;
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useViewerCacheScope: () => VIEWER,
}));

/** The viewer's characters come through a real query, so `['me', 'characters']` invalidation refetches them. */
let myChars: { id: string }[] = [];
vi.mock('../../../hooks/use-characters', async () => {
    const { useQuery } = await import('@tanstack/react-query');
    return {
        useMyCharacters: (gameId?: number, enabled = true) => useQuery({
            queryKey: ['me', 'characters', gameId ?? null],
            queryFn: () => Promise.resolve({ data: [...myChars], meta: { total: myChars.length } }),
            enabled,
        }),
    };
});

interface StubProps { onClose: () => void; initialTab?: string; rosterGuildId?: number; gameSlug?: string }
vi.mock('../../../components/profile/AddCharacterModal', () => ({
    AddCharacterModal: (p: StubProps): JSX.Element => (
        <div data-testid="add-character-modal" data-tab={p.initialTab} data-guild={String(p.rosterGuildId)} data-slug={p.gameSlug}>
            <button type="button" onClick={() => { myChars = [...myChars, { id: 'claimed-char' }]; p.onClose(); }}>stub-claim</button>
        </div>
    ),
}));

const API = 'http://localhost:3000';
const FOREVER = 'world-of-warcraft-forever';
const CELL_ID = 'hub-widget-blizzard-forever-claim-banner';

interface Opts {
    id?: number;
    isStaff?: boolean;
    gameSlug?: string;
    /** The join gate's answer; `null` = 404 (not a claimable guild). */
    isMember?: boolean | null;
    /** Pre-seed the join-gate answer (the "no banner" cases). */
    seed?: boolean;
}

function gateDto(id: number, isMember: boolean): WowGuildJoinGateDto {
    return {
        guild: { id, gameId: 4, name: 'Iron Remnant', region: 'us', realmName: 'Thunderfury', memberCount: 142, crest: null },
        viewer: { isMember, hasForeverCharacter: myChars.length > 0 },
    };
}

function pageDto(id: number, isStaff: boolean, gameSlug: string): GuildPageDto {
    return {
        guild: { id, gameId: 4, kind: 'wow_guild', name: 'Iron Remnant', region: 'us', realmSlug: null, realmName: 'Thunderfury',
            faction: 'Horde', memberCount: 142, lastSnapshotAt: null, gameSlug },
        importedBy: null,
        viewer: { role: isStaff ? 'leader' : 'member', canEdit: false, canManageEditors: false, isStaff },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

/** Join-gate answer per guild id, mutable mid-test (a claim that confers membership). */
const gateMember = new Map<number, boolean | null>();
let gateCalls: number[] = [];

function serve(id: number, isStaff: boolean, gameSlug: string): void {
    server.use(
        http.get(`${API}/guilds/${id}`, () => HttpResponse.json(pageDto(id, isStaff, gameSlug))),
        http.get(`${API}/plugins/wow/guilds/${id}/join-gate`, () => {
            gateCalls.push(id);
            const member = gateMember.get(id) ?? null;
            return member === null ? HttpResponse.json({ message: 'Hub not found' }, { status: 404 }) : HttpResponse.json(gateDto(id, member));
        }),
    );
}

function renderPage({ id = 7, isStaff = true, gameSlug = FOREVER, isMember = false, seed = false }: Opts = {}): { queryClient: QueryClient; unmount: () => void } {
    gateMember.set(id, isMember);
    serve(id, isStaff, gameSlug);
    const queryClient = createTestQueryClient();
    if (seed && isMember !== null) queryClient.setQueryData(joinGateKey(id, VIEWER), gateDto(id, isMember));
    const { unmount } = renderWithProviders(
        <Routes><Route path="/hubs/:id" element={<GuildPage />} /></Routes>,
        { initialEntries: [`/hubs/${id}`], queryClient },
    );
    return { queryClient, unmount };
}

/** The Overview grid is up, so every widget cell (and probe) has rendered. */
async function overviewReady(): Promise<HTMLElement> {
    return screen.findByTestId('guild-overview', {}, { timeout: 3000 });
}

const findBanner = (): Promise<HTMLElement> => screen.findByTestId('wow-claim-banner', {}, { timeout: 3000 });

beforeEach(() => {
    activateWowPlugin();
    myChars = [];
    gateMember.clear();
    gateCalls = [];
    sessionStorage.clear();
});
afterEach(() => { sessionStorage.clear(); });

describe('staff claim banner — who sees it (AC 1, 2)', () => {
    it('a staff non-member sees the banner above the other Overview cards, with the copy and button', async () => {
        renderPage();
        const banner = await findBanner();
        expect(banner).toHaveAccessibleName(CLAIM_BANNER_COPY.label);
        expect(banner).toHaveTextContent("You're not a member of this guild yet — Claim your character to join.");
        expect(within(banner).getByRole('button', { name: 'Claim your character' })).toBeInTheDocument();
        expect(within(banner).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
        const grid = await overviewReady();
        expect(grid.firstElementChild, 'the banner is the first Overview cell').toHaveAttribute('id', CELL_ID);
        expect(gateCalls, 'the banner reads the real join gate').toContain(7);
    });

    it('a staff viewer who is a member sees no banner', async () => {
        renderPage({ isMember: true, seed: true });
        await overviewReady();
        expect(document.getElementById(CELL_ID), 'a member must not be asked to claim').toBeNull();
        expect(screen.queryByTestId('wow-claim-banner')).toBeNull();
    });

    it('a non-staff viewer sees no banner and the join gate is never requested', async () => {
        // The gate would say "not a member" if asked: only the isStaff check keeps the banner away.
        const { queryClient } = renderPage({ isStaff: false, isMember: false });
        await overviewReady();
        expect(document.getElementById(CELL_ID), 'a non-staff viewer must not see the staff banner').toBeNull();
        const gateQuery = queryClient.getQueryCache().find({ queryKey: joinGateKey(7, VIEWER) });
        expect(gateQuery?.state.fetchStatus, 'the join-gate read must stay disabled for non-staff').toBe('idle');
        expect(gateQuery?.state.dataUpdatedAt, 'the join-gate read must never have run').toBe(0);
        await waitFor(() => expect(screen.getByRole('navigation', { name: 'Guild page sections' })).toBeInTheDocument());
        expect(gateCalls, 'the join-gate handler must never be hit for a non-staff viewer').toEqual([]);
    });

    it('a guild the join gate 404s (not claimable) shows no banner; the page still renders', async () => {
        const { queryClient } = renderPage({ isMember: null });
        await overviewReady();
        await waitFor(() => expect(queryClient.getQueryCache().find({ queryKey: joinGateKey(7, VIEWER) })?.state.status).toBe('error'));
        expect(gateCalls).toContain(7);
        expect(document.getElementById(CELL_ID)).toBeNull();
        expect(screen.getByRole('navigation', { name: 'Guild page sections' })).toBeInTheDocument();
    });

    it('a non-Forever WoW guild shows no banner (games filter)', async () => {
        renderPage({ gameSlug: 'world-of-warcraft-classic', seed: true });
        await overviewReady();
        expect(document.getElementById(CELL_ID), 'the banner is a Forever-only widget').toBeNull();
    });
});

describe('staff claim banner — the claim (AC 3, 4, 5)', () => {
    it('Claim your character opens Add character on this guild\'s roster tab', async () => {
        renderPage();
        await userEvent.click(within(await findBanner()).getByRole('button', { name: 'Claim your character' }));
        const modal = await screen.findByTestId('add-character-modal');
        expect(modal).toHaveAttribute('data-tab', 'roster');
        expect(modal).toHaveAttribute('data-guild', '7');
        expect(modal).toHaveAttribute('data-slug', FOREVER);
    });

    it('a claim that confers membership closes the modal and the banner goes without a reload', async () => {
        renderPage();
        await userEvent.click(within(await findBanner()).getByRole('button', { name: 'Claim your character' }));
        gateMember.set(7, true);
        const callsBefore = gateCalls.length;
        await userEvent.click(await screen.findByRole('button', { name: 'stub-claim' }));
        await waitFor(() => expect(screen.queryByTestId('wow-claim-banner'), 'membership arrived: the banner must go').toBeNull());
        expect(gateCalls.length, 'closing the modal refetched the join gate').toBeGreaterThan(callsBefore);
        expect(screen.queryByTestId('add-character-modal')).toBeNull();
        expect(screen.getByTestId('guild-overview')).toBeInTheDocument();
    });

    it('a claim that gains a character but not membership warns inside the banner and does not reopen the modal', async () => {
        renderPage();
        await userEvent.click(within(await findBanner()).getByRole('button', { name: 'Claim your character' }));
        await userEvent.click(await screen.findByRole('button', { name: 'stub-claim' }));
        const banner = await findBanner();
        expect(await within(banner).findByTestId('wow-join-gate-warning')).toHaveTextContent(NOT_LINKED_WARNING);
        expect(screen.queryByTestId('add-character-modal'), 'the banner must not reopen the modal on its own').toBeNull();
    });
});

describe('staff claim banner — dismiss for the session (AC 6)', () => {
    it('× hides it for this guild, it stays hidden on a remount, and another guild still shows it', async () => {
        const first = renderPage();
        await userEvent.click(within(await findBanner()).getByRole('button', { name: 'Dismiss' }));
        await waitFor(() => expect(screen.queryByTestId('wow-claim-banner')).toBeNull());
        expect(sessionStorage.getItem('rl:wow-claim-banner-dismissed:7')).toBe('1');
        first.unmount();

        const again = renderPage({ seed: true });
        await overviewReady();
        expect(document.getElementById(CELL_ID), 'dismissed this session: still hidden after a remount').toBeNull();
        again.unmount();

        renderPage({ id: 8 });
        expect(await findBanner(), 'another guild is unaffected by the dismiss').toBeInTheDocument();
    });
});

describe('staff claim banner — plugin ownership (AC 8)', () => {
    it('with the WoW (blizzard) plugin off there is no banner', async () => {
        usePluginStore.setState({ activeSlugs: new Set<string>() });
        renderPage({ seed: true });
        await overviewReady();
        expect(document.getElementById(CELL_ID), 'an inactive plugin\'s widget must not render').toBeNull();
    });
});
