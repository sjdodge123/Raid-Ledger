/**
 * ROK-1870 — MSW factories + handlers for the community-hub surfaces the game
 * page card and the `/hubs` directory read. Not registered globally: specs
 * install them with `server.use(...communityHubHandlers({ ... }))`.
 */
import { http, HttpResponse } from 'msw';
import {
    CreateHubProposalSchema,
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
        viewer: 'not-member', ...overrides,
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

/** `GET /hubs/by-game/:gameId` payload. */
export function createMockGameHubs(overrides: Partial<GameHubs> = {}): GameHubs {
    return { hubs: [], myProposals: [], canPropose: true, proposeBlockedReason: null, ...overrides };
}

/** `GET /hubs` payload. */
export function createMockHubDirectoryPage(overrides: Partial<HubDirectoryPage> = {}): HubDirectoryPage {
    const items = overrides.items ?? [createMockHubEntry()];
    return { items, nextCursor: null, total: items.length, ...overrides };
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
        http.get(`${API}/hubs`, () => HttpResponse.json(directory)),
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
