/**
 * ROK-1610 — an EXPIRED poll is not always a dead end.
 *
 * When the deadline runs out but the members who voted picked a time that is
 * STILL AHEAD, the organiser keeps one action on the terminal banner:
 * `Schedule <time>` (`expired-lock-in-action`), and the banner's sub-copy
 * stops telling them to start a new poll.
 *
 * The fixture reaches that state entirely through the API + the DEMO_MODE
 * expiry endpoints — suggest a slot a week out (which auto-votes the
 * organiser), drag the deadline six minutes into the past, then run the
 * 5-minute sweep on demand — so nothing here waits on a clock.
 *
 * Only the presence and label of the action are asserted. Clicking it creates
 * a real event and signs its voters up; that path is covered by
 * `scheduling-lock-in.integration.spec.ts` and the `use-expired-lock-in`
 * vitest cases, and re-proving it in a browser would leave an event behind on
 * a shared env.
 *
 * Requires DEMO_MODE=true (admin is the poll's creator, hence its organiser).
 */
import { test, expect } from './base';
import { dismissGameTimeCheck } from './helpers';
import {
    apiGet,
    apiPatch,
    apiPost,
    getAdminToken,
    pollForCondition,
} from './api-helpers';

/** A configured game to hang the poll off. */
async function firstGameId(token: string): Promise<number> {
    const body = (await apiGet(token, '/games/configured')) as {
        data?: { id: number }[];
    } | null;
    const id = body?.data?.[0]?.id;
    if (!id) throw new Error('No configured games to start a poll from');
    return id;
}

interface ExpiredPoll {
    lineupId: number;
    matchId: number;
}

/**
 * Create a poll, put one voted time a week out on it, then expire it by
 * deadline. Returns the ids; the caller archives the lineup afterwards.
 */
async function createExpiredPollWithFutureVotedSlot(
    token: string,
): Promise<ExpiredPoll> {
    const gameId = await firstGameId(token);
    const poll = (await apiPost(token, '/scheduling-polls', {
        gameId,
        durationHours: 24,
    })) as { id: number; lineupId: number };
    const base = `/lineups/${poll.lineupId}/schedule/${poll.id}`;

    // Suggesting auto-votes the suggester, so this slot has a voter — the
    // condition the post-expiry lock-in is gated on.
    await apiPost(token, `${base}/suggest`, {
        proposedTime: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });

    // Deadline six minutes ago, then the sweep that closes such polls.
    await apiPost(token, '/admin/test/advance-standalone-poll-deadline', {
        lineupId: poll.lineupId,
        hoursUntilDeadline: -0.1,
    });
    await apiPost(token, '/admin/test/scheduling-poll/run-expiry-sweep', {});

    // The page's own query has a staleTime, so wait for the API to agree the
    // poll is both terminal AND still finishable before the browser asks for
    // it — `canLockIn` is the exact gate the banner's action is drawn from.
    await pollForCondition(
        async () => {
            const data = (await apiGet(token, base)) as {
                canLockIn?: boolean;
                lockInSlotId?: number | null;
            } | null;
            return data?.canLockIn === true && data.lockInSlotId ? data : null;
        },
        {
            timeoutMs: 20_000,
            description:
                'the expiry sweep to close the poll while it stays lockable',
        },
    );

    return { lineupId: poll.lineupId, matchId: poll.id };
}

test.describe('Expired poll — the organiser can still schedule (ROK-1610)', () => {
    test('the terminal banner offers "Schedule <time>" for a future voted slot', async ({
        page,
    }) => {
        const token = await getAdminToken();
        const poll = await createExpiredPollWithFutureVotedSlot(token);
        try {
            await page.goto(
                `/community-lineup/${poll.lineupId}/schedule/${poll.matchId}`,
            );
            await dismissGameTimeCheck(page);

            const action = page.getByTestId('expired-lock-in-action');
            await expect(
                action,
                'ROK-1610: an expired poll whose voters picked a time that is still ahead must offer the organiser "Schedule <time>" on the terminal banner. A missing button here means the page fell back to the plain expired body — check that the poll page passes lockInLabel/onLockIn (canLockIn + lockInSlotId) down to SchedulingTerminalBanner.',
            ).toBeVisible({ timeout: 15_000 });
            await expect(action).toHaveText(/^Schedule \S/);

            // The banner must stop telling the organiser to re-poll when the
            // poll can still be finished as it stands.
            await expect(
                page.getByText('Start a new poll from the game', {
                    exact: false,
                }),
            ).toHaveCount(0);
        } finally {
            await apiPatch(token, `/lineups/${poll.lineupId}/status`, {
                status: 'archived',
            }).catch(() => null);
        }
    });
});
