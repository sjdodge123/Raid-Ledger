/**
 * ROK-1870 — MSW factories + handlers for the community-hub surfaces the game
 * page card and the `/hubs` directory read. Not registered globally: specs
 * install them with `server.use(...communityHubHandlers({ ... }))`.
 */
import { http, HttpResponse } from 'msw';
import {
    CreateHubProposalSchema,
    GUILD_KINDS,
    type GameHubs,
    type HubDirectoryEntry,
    type HubDirectoryPage,
    type HubProposal,
} from '@raid-ledger/contract';
import { withJoin } from '../../pages/game-detail/hub-join';

const API = 'http://localhost:3000';

/** One directory / game-card hub row. */
export function createMockHubEntry(overrides: Partial<HubDirectoryEntry> = {}): HubDirectoryEntry {
    return {
        id: 1, gameId: 5, gameName: "Baldur's Gate 3", gameIconUrl: null, name: 'Tavern Regulars',
        blurb: 'Honour-mode runs on Friday nights.', memberCount: 14, leaderName: 'Mirelle',
        viewer: 'not-member', kind: 'game_community', ...overrides,
    };
}

/** One of the viewer's pending proposals. */
export function createMockHubProposal(overrides: Partial<HubProposal> = {}): HubProposal {
    return {
        id: 13, gameId: 5, gameName: "Baldur's Gate 3", gameIconUrl: null, name: 'Late-Night Larian',
        blurb: 'Act 3 grind after 11 PM.', proposedBy: { userId: 1, username: 'You', avatarUrl: null },
        createdAt: '2026-10-20T12:00:00.000Z', ...overrides,
    };
}

/** `GET /hubs/by-game/:gameId` payload; `total` defaults to the distinct hub ids given. */
export function createMockGameHubs(overrides: Partial<GameHubs> = {}): GameHubs {
    const total = new Set((overrides.hubs ?? []).map((h) => h.id)).size;
    return { hubs: [], total, myProposals: [], canPropose: true, proposeBlockedReason: null, ...overrides };
}

/** ROK-1875: a game-server hub row (no leader; membership is presence-driven). */
export function createMockServerHubEntry(overrides: Partial<HubDirectoryEntry> = {}): HubDirectoryEntry {
    return createMockHubEntry({
        id: 310, gameId: 7, gameName: 'Valheim', name: 'Valheim — Gamernight', blurb: null,
        memberCount: 12, leaderName: null, viewer: 'not-member', kind: 'game_server', ...overrides,
    });
}

/** ROK-1883: a WoW guild hub row (membership is character-driven; no leader). */
export function createMockGuildHubEntry(overrides: Partial<HubDirectoryEntry> = {}): HubDirectoryEntry {
    return createMockHubEntry({
        id: 420, name: 'Lantern Watch', blurb: 'Whitemane · Alliance raiding guild', memberCount: 38,
        leaderName: null, viewer: 'member', kind: 'wow_guild', ...overrides,
    });
}

/**
 * ROK-1883 — a `GET /hubs/by-game/5` payload with every kind, joined first: a
 * guild and a server hub the viewer is in, then a community hub to join.
 * `staff` adds the staff-only `hidden` flag to each row and a hidden server hub.
 */
export function createMockGameHubsAllKinds(opts: { staff?: boolean } = {}): GameHubs {
    const staff = opts.staff === true;
    const flag = (hidden: boolean): Partial<HubDirectoryEntry> => (staff ? { hidden } : {});
    const onGame = { gameId: 5, gameName: "Baldur's Gate 3" };
    const hubs = [
        createMockGuildHubEntry({ ...onGame, ...flag(false) }),
        createMockServerHubEntry({ ...onGame, name: 'Forever Test Realm', viewer: 'member', ...flag(false) }),
        ...(staff ? [createMockServerHubEntry({ ...onGame, id: 311, name: 'Valheim Dedicated', memberCount: 4, hidden: true })] : []),
        createMockHubEntry({ name: 'Dungeon Night Crew', memberCount: 9, ...flag(false) }),
    ];
    return createMockGameHubs({ hubs });
}

/** `GET /hubs` payload; `kinds` defaults to the kinds of its items in `GUILD_KINDS` order. */
export function createMockHubDirectoryPage(overrides: Partial<HubDirectoryPage> = {}): HubDirectoryPage {
    const items = overrides.items ?? [createMockHubEntry()];
    const kinds = GUILD_KINDS.filter((k) => items.some((e) => e.kind === k));
    return { items, nextCursor: null, total: items.length, kinds, ...overrides };
}

export interface CommunityHubMockState {
    gameHubs?: GameHubs;
    directory?: HubDirectoryPage;
}

/** Default handlers: reads return the given state, Join / Leave update it, other writes echo success. */
export function communityHubHandlers(state: CommunityHubMockState = {}) {
    let gameHubs = state.gameHubs ?? createMockGameHubs();
    let directory = state.directory ?? createMockHubDirectoryPage();
    const setJoined = (id: number, joined: boolean): number => {
        const patch = (e: HubDirectoryEntry): HubDirectoryEntry => (e.id === id ? withJoin(e, joined) : e);
        gameHubs = { ...gameHubs, hubs: gameHubs.hubs.map(patch) };
        directory = { ...directory, items: directory.items.map(patch) };
        const hub = [...gameHubs.hubs, ...directory.items].find((e) => e.id === id);
        return hub?.memberCount ?? 0;
    };
    return [
        http.get(`${API}/hubs/by-game/:gameId`, () => HttpResponse.json(gameHubs)),
        http.get(`${API}/hubs`, ({ request }) => {
            const kind = new URL(request.url).searchParams.get('kind');
            const items = kind ? directory.items.filter((e) => e.kind === kind) : directory.items;
            return HttpResponse.json({ ...directory, items, total: items.length });
        }),
        http.post(`${API}/hubs/proposals`, async ({ request }) => {
            const parsed = CreateHubProposalSchema.safeParse(await request.json());
            if (!parsed.success) return HttpResponse.json({ message: 'Bad request' }, { status: 400 });
            const { gameId, name, blurb } = parsed.data;
            return HttpResponse.json(createMockHubProposal({ id: 99, gameId, name, blurb }), { status: 201 });
        }),
        http.delete(`${API}/hubs/proposals/:id`, () => new HttpResponse(null, { status: 204 })),
        http.post(`${API}/hubs/:id/join`, ({ params }) =>
            HttpResponse.json({ joined: true, memberCount: setJoined(Number(params.id), true) })),
        http.delete(`${API}/hubs/:id/join`, ({ params }) =>
            HttpResponse.json({ joined: false, memberCount: setJoined(Number(params.id), false) })),
    ];
}
