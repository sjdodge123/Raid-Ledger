/** ROK-1933 Part 1 — the claim banner on the Characters tab and the Overview card. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { JSX } from 'react';
import type { GuildPage, GuildRaidsDto, ValheimCharacterSummary } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient, renderWithProviders } from '../../../test/render-helpers';
import {
    VALHEIM_CHARACTERS_URL,
    VALHEIM_CLAIM_STATUS_URL,
    valheimCharacterClaimed,
    valheimCharacterUnclaimed,
} from '../../../test/mocks/valheim-armory-handlers';
import { useLocation } from 'react-router-dom';
import { valheimArmoryKeys } from '../lib/valheim-armory-api';
import { invalidateOwnership } from '../hooks/use-valheim-claims';
import { ValheimCharactersTab } from './valheim-characters-tab';
import { ValheimClaimBanner } from './valheim-claim-banner';
import ValheimCharactersHubTab from './valheim-characters-hub-tab';
import { useClaimBannerWidgetVisible } from '../hooks/use-valheim-claim-banner';

const auth = vi.hoisted(() => ({ user: { id: 9, steamId: null as string | null } }));
const linkSteam = vi.hoisted(() => vi.fn());

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    getAuthToken: vi.fn(() => 'test-token'),
    useAuth: () => ({ user: auth.user }),
}));
vi.mock('../../../hooks/use-steam-link', () => ({
    useSteamLink: () => ({ linkSteam, isLinkPending: false }),
}));

let rows: ValheimCharacterSummary[] = [];
/** Search strings of every list request, to prove the filter went to the server. */
let listQueries: string[] = [];
const mine = (): ValheimCharacterSummary => ({
    ...valheimCharacterUnclaimed,
    claimedBy: { id: 9, username: 'me', avatar: null, discordId: '9' },
    claimSource: 'manual',
});
const heading = /playing on/i;

beforeEach(() => {
    auth.user = { id: 9, steamId: null };
    rows = [valheimCharacterClaimed, valheimCharacterUnclaimed];
    listQueries = [];
    server.use(
        http.get(VALHEIM_CHARACTERS_URL, ({ request }) => {
            const q = new URL(request.url).searchParams;
            listQueries.push(q.toString());
            const unclaimed = q.get('unclaimed') === '1';
            return HttpResponse.json({ data: unclaimed ? rows.filter((r) => r.claimedBy === null) : rows });
        }),
        // The server's facts, derived from the same rows the list serves.
        http.get(VALHEIM_CLAIM_STATUS_URL, () => HttpResponse.json({
            viewerHasClaim: rows.some((r) => r.claimedBy?.id === auth.user.id),
            unclaimedCount: rows.filter((r) => r.claimedBy === null).length,
        })),
    );
});
afterEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/');
});

/** The router's current URL, so a test can see what a navigate kept or dropped. */
function LocationProbe(): JSX.Element {
    const { search, hash } = useLocation();
    return <output data-testid="router-url">{`${search}${hash}`}</output>;
}
const routerUrl = (): string => screen.getByTestId('router-url').textContent ?? '';

/** Claim status pre-seeded, so a missing banner means "dismissed", never "still loading". */
function overview(queryClient = createTestQueryClient()): void {
    queryClient.setQueryData(valheimArmoryKeys.claimStatus(7), { viewerHasClaim: false, unclaimedCount: 1 });
    renderWithProviders(
        <ValheimClaimBanner serverId={7} dismissible />,
        { initialEntries: ['/hubs/4'], queryClient },
    );
}

describe('claim banner — Characters tab', () => {
    it('shows Link Steam + Pick when the viewer has no claim and one is unclaimed', async () => {
        renderWithProviders(<ValheimCharactersTab serverId={7} />);
        expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Link Steam' }));
        expect(linkSteam).toHaveBeenCalledWith('/#characters');
        expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
    });

    it('stays hidden when every character is claimed', async () => {
        rows = [valheimCharacterClaimed];
        renderWithProviders(<ValheimCharactersTab serverId={7} />);
        expect(await screen.findByText('member1')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: heading })).not.toBeInTheDocument();
    });

    it('drops Link Steam for a Steam-linked viewer (variant b)', async () => {
        auth.user = { id: 9, steamId: '76561198000000000' };
        renderWithProviders(<ValheimCharactersTab serverId={7} />);
        expect(await screen.findByRole('heading', { name: /can't find your character/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Link Steam' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Pick my character' })).toBeInTheDocument();
    });

    it('hides after the viewer claims (the claim mutation\'s own invalidation)', async () => {
        const queryClient = createTestQueryClient();
        renderWithProviders(<ValheimCharactersTab serverId={7} />, { queryClient });
        expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
        // Another character stays unclaimed, so only the viewer's claim can hide it.
        rows = [{ ...valheimCharacterUnclaimed, id: 99, name: 'Other' }, mine()];
        // What useClaimCharacter/useAssignOwner run on settle — not a hand-picked key.
        await invalidateOwnership(queryClient, 99);
        await waitFor(() => expect(screen.queryByRole('heading', { name: heading })).not.toBeInTheDocument());
    });

    it('Pick my character filters the list to unclaimed rows', async () => {
        renderWithProviders(<ValheimCharactersTab serverId={7} />);
        await userEvent.click(await screen.findByRole('button', { name: 'Pick my character' }));
        expect(screen.getByRole('button', { name: 'Unclaimed only' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByText('member1')).not.toBeInTheDocument();
        expect(screen.getByText(valheimCharacterUnclaimed.name)).toBeInTheDocument();
        expect(listQueries.at(-1)).toContain('unclaimed=1');
    });

    it('shows on a server bigger than one list page when only the server knows a row is unclaimed (D1)', async () => {
        const full = Array.from({ length: 50 }, (_, i) => ({ ...valheimCharacterClaimed, id: 100 + i, name: `Viking ${i}` }));
        server.use(
            http.get(VALHEIM_CHARACTERS_URL, () => HttpResponse.json({ data: full })),
            http.get(VALHEIM_CLAIM_STATUS_URL, () => HttpResponse.json({ viewerHasClaim: false, unclaimedCount: 4 })),
        );
        renderWithProviders(<ValheimCharactersTab serverId={7} />);
        expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Load more characters' })).toBeInTheDocument();
    });

    it('ignores an Overview dismiss and stays shown', async () => {
        overview();
        await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
        renderWithProviders(<ValheimCharactersTab serverId={7} />);
        expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    });
});

describe('claim banner — Characters tab inside the hub frame', () => {
    it('the Unclaimed only toggle keeps #characters (the hub reads its tab from the hash)', async () => {
        renderWithProviders(<><ValheimCharactersTab serverId={7} /><LocationProbe /></>, { initialEntries: ['/hubs/4?post=3#characters'] });
        await userEvent.click(await screen.findByRole('button', { name: 'Unclaimed only' }));
        expect(routerUrl()).toBe('?post=3&unclaimed=1#characters');
        await userEvent.click(screen.getByRole('button', { name: 'Unclaimed only' }));
        expect(routerUrl()).toBe('?post=3#characters');
    });

    it('draws its own "Claim your character" region on the tab', async () => {
        renderWithProviders(<ValheimCharactersTab serverId={7} />);
        expect(await screen.findByRole('region', { name: 'Claim your character' })).toBeInTheDocument();
    });
});

describe('claim banner — Overview', () => {
    it('a dismiss hides it and is remembered across renders', async () => {
        overview();
        expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
        expect(screen.queryByRole('heading', { name: heading })).not.toBeInTheDocument();
        overview();
        expect(screen.queryByRole('heading', { name: heading })).not.toBeInTheDocument();
    });

    it('is the one region and the one heading on the Overview (chromeless card, mockup callout)', () => {
        overview();
        const region = screen.getByRole('region', { name: 'Claim your character' });
        expect(within(region).getAllByRole('heading')).toHaveLength(1);
        expect(region).toHaveClass('bg-overlay/30', 'border-edge', 'rounded-lg', 'p-4');
        expect(within(region).getByRole('heading', { name: heading })).toHaveClass('text-base');
    });

    it('top-aligns the desktop actions with the copy (approved mockup, ROK-1933)', () => {
        overview();
        const region = screen.getByRole('region', { name: 'Claim your character' });
        expect(region).toHaveClass('lg:flex-row', 'lg:items-start');
        expect(region).not.toHaveClass('lg:items-center');
    });

    it('pins the × to the top-right corner through a positioned wrapper, not the Button', () => {
        overview();
        const button = screen.getByRole('button', { name: 'Dismiss' });
        const corner = screen.getByTestId('claim-banner-dismiss');
        expect(corner).toHaveClass('absolute', 'right-1', 'top-1');
        expect(corner).toContainElement(button);
        expect(button).not.toHaveClass('absolute');
        expect(button).toHaveClass('min-w-[44px]', 'min-h-[44px]');
        const region = screen.getByRole('region', { name: 'Claim your character' });
        expect(region).toHaveClass('lg:pr-12');
        expect(region).not.toHaveClass('pr-10');
        expect(screen.getByRole('heading', { name: heading }).parentElement).toHaveClass('pr-10', 'lg:pr-0');
    });

    it('Pick my character switches tabs with a hash write and keeps other params', async () => {
        const queryClient = createTestQueryClient();
        queryClient.setQueryData(valheimArmoryKeys.claimStatus(7), { viewerHasClaim: false, unclaimedCount: 1 });
        renderWithProviders(<><ValheimClaimBanner serverId={7} dismissible /><LocationProbe /></>, { initialEntries: ['/hubs/4?post=3'], queryClient });
        const changes: string[] = [];
        window.addEventListener('hashchange', () => changes.push(window.location.hash));
        await userEvent.click(screen.getByRole('button', { name: 'Pick my character' }));
        expect(routerUrl()).toContain('?post=3&unclaimed=1');
        await waitFor(() => expect(changes).toEqual(['#characters']));
    });
});

type Viewer = GuildPage['viewer'];
const MEMBER: Viewer = { role: 'member', canEdit: false, canManageEditors: false, notificationsMuted: false };
const VISITOR: Viewer = { role: 'visitor', canEdit: false, canManageEditors: false };
/** An admin is laddered `leader` on every hub; the API omits the mute for a non-member. */
const STAFF_NON_MEMBER: Viewer = { role: 'leader', canEdit: true, canManageEditors: true };

function hubPage(viewer: Viewer): GuildPage {
    return {
        guild: { id: 4, gameId: 3, kind: 'game_server', name: 'Valheim', region: 'server', realmSlug: null, realmName: null, faction: null, memberCount: 1, lastSnapshotAt: null, gameSlug: 'valheim' },
        importedBy: null,
        viewer,
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
        server: { pelicanServerId: 7, gameSlug: 'valheim', gameIconUrl: null, state: 'running', viewerJoined: true },
    };
}

/** Both hub surfaces for one viewer: the Overview probe's verdict and the Characters tab. */
function HubSurfaces({ page }: { page: GuildPage }): JSX.Element {
    const raids = useQuery<GuildRaidsDto, Error>({ queryKey: ['idle-raids'], queryFn: () => new Promise(() => undefined), enabled: false });
    const overviewVisible = useClaimBannerWidgetVisible({ page, raids, gameSlug: 'valheim' });
    return <><output data-testid="overview-visible">{String(overviewVisible)}</output><ValheimCharactersHubTab page={page} raids={raids} /></>;
}

function renderSurfaces(viewer: Viewer): void {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(valheimArmoryKeys.claimStatus(7), { viewerHasClaim: false, unclaimedCount: 1 });
    renderWithProviders(<HubSurfaces page={hubPage(viewer)} />, { queryClient });
}

describe('claim banner — hub members only (spec Part 1 "Who sees it")', () => {
    it('shows on the Overview and the Characters tab for a hub member', async () => {
        renderSurfaces(MEMBER);
        expect(await screen.findByRole('region', { name: 'Claim your character' })).toBeInTheDocument();
        expect(screen.getByTestId('overview-visible')).toHaveTextContent('true');
    });

    it.each([['a visitor', VISITOR], ['a non-member admin', STAFF_NON_MEMBER]])('never shows to %s, on either surface', async (_who, viewer) => {
        renderSurfaces(viewer);
        expect(await screen.findByRole('list')).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'Claim your character' })).not.toBeInTheDocument();
        expect(screen.getByTestId('overview-visible')).toHaveTextContent('false');
    });
});

