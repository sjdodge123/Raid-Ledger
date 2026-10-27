/**
 * ROK-2020 — MSW handlers for a scheduling poll's roster and the
 * remove-participant endpoint. Not in the default handler set — specs opt in
 * with `server.use(...)` and read the returned `calls` to assert what was (or
 * was not) sent.
 */
import { http, HttpResponse } from 'msw';
import type { LineupParticipantDto } from '@raid-ledger/contract';

const API_BASE = 'http://localhost:3000';

export const PARTICIPANTS_URL = `${API_BASE}/lineups/:lineupId/participants`;
export const REMOVE_MEMBER_URL = `${API_BASE}/lineups/:lineupId/schedule/:matchId/members/:userId`;

export function createMockPollParticipant(
    overrides: Partial<LineupParticipantDto> = {},
): LineupParticipantDto {
    return {
        userId: 2,
        displayName: 'Bob',
        avatar: null,
        customAvatarUrl: null,
        discordId: null,
        role: 'participant',
        status: 'voted',
        steamLinked: false,
        ...overrides,
    };
}

/** `GET /lineups/:lineupId/participants` — the roster; records each `matchId` query. */
export function pollParticipantsHandler(participants: LineupParticipantDto[], calls: string[] = []) {
    return http.get(PARTICIPANTS_URL, ({ request }) => {
        calls.push(new URL(request.url).searchParams.get('matchId') ?? '');
        return HttpResponse.json({ participants });
    });
}

export type RemoveMemberOutcome =
    | { removedVotes: number; memberCount: number }
    | { status: 400 | 403 | 404; message: string };

/**
 * `DELETE /lineups/:lineupId/schedule/:matchId/members/:userId` — records
 * `lineupId/matchId/userId`. `gate`, when given, holds the response until it
 * resolves (to observe the optimistic state).
 */
export function removePollMemberHandler(
    outcome: RemoveMemberOutcome,
    calls: string[] = [],
    gate?: Promise<void>,
) {
    return http.delete(REMOVE_MEMBER_URL, async ({ params }) => {
        calls.push(`${String(params.lineupId)}/${String(params.matchId)}/${String(params.userId)}`);
        if (gate) await gate;
        if ('status' in outcome) {
            return HttpResponse.json(
                { statusCode: outcome.status, message: outcome.message },
                { status: outcome.status },
            );
        }
        return HttpResponse.json(outcome);
    });
}
