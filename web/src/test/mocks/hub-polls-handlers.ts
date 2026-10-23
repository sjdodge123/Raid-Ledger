/**
 * ROK-1893 P3 — MSW handlers for hub polls: `GET /hubs/:id/polls` (the hub
 * Events tab's "Open polls") and `POST /hubs/:id/join` (the poll page's Join
 * hub). Not in the default handler set — specs opt in with `server.use(...)`
 * and read the returned `calls` to assert what was sent.
 */
import { http, HttpResponse } from 'msw';
import type { ActiveStandalonePollDto, CommunityHubJoinResponse } from '@raid-ledger/contract';

const API_BASE = 'http://localhost:3000';

export function createMockActivePoll(overrides: Partial<ActiveStandalonePollDto> = {}): ActiveStandalonePollDto {
    return {
        matchId: 41, lineupId: 40, gameName: "Baldur's Gate 3", gameCoverUrl: null,
        memberCount: 6, slotCount: 3, visibility: 'public', hub: { id: 7, name: 'Tavern Regulars' }, ...overrides,
    };
}

export interface HubPollsCalls { listed: number[]; joined: number[] }

export function hubPollsHandlers(polls: ActiveStandalonePollDto[], calls: HubPollsCalls = { listed: [], joined: [] }) {
    return [
        http.get(`${API_BASE}/hubs/:id/polls`, ({ params }) => {
            calls.listed.push(Number(params.id));
            return HttpResponse.json(polls);
        }),
        http.post(`${API_BASE}/hubs/:id/join`, ({ params }) => {
            calls.joined.push(Number(params.id));
            const body: CommunityHubJoinResponse = { joined: true, memberCount: 15 };
            return HttpResponse.json(body);
        }),
    ];
}
