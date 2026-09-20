/**
 * Anti-vote ("Doesn't work") smoke tests — ROK-1617.
 *
 * Per member per proposed time there are THREE answers: yes / no / not
 * answered. These specs drive the three-state control in a real browser on a
 * freshly seeded standalone scheduling poll:
 *
 *   1. NO then clear      — press "Doesn't work", press it again, back to unanswered
 *   2. YES ↔ NO switch    — one answer per member per slot, never both
 *   3. NO is not a pick    — the yes count does not move; the `· N can’t`
 *                            clause appears on the row AND the leader card
 *   4. Survives reload     — the NO round-tripped through the API, it is not
 *                            just an optimistic cache entry
 *
 * Every test seeds its OWN poll and deletes it in `finally`: a shared poll
 * mutated by a neighbouring spec produced a one-shard flake in this suite.
 *
 * Runs unskipped in every viewport project (desktop / mobile / tablet) — both
 * vote controls render at all widths (`w-full` below `sm`, `sm:w-auto` above),
 * so every assertion below is on role / accessible name / test id / data
 * attribute, never on position.
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './base';
import {
    API_BASE,
    getAdminToken,
    apiDelete,
    apiGet,
    apiPatch,
    apiPost,
    pollForCondition,
} from './api-helpers';

/**
 * On a phone layout the "confirm your game time" sheet UNMOUNTS the slot list
 * (`SchedulingComposite.tsx`: `{!check.sheetVisible && <SchedulingSlotList/>}`),
 * and it opens whenever the viewer's game time has never been confirmed — which
 * is every fresh CI database until some OTHER spec happens to stamp it. That made
 * these cases pass or fail by shard composition (ROK-1617: 12/12 red on [mobile]
 * in one shard, green everywhere else). Confirm it server-side, up front.
 */
test.beforeAll(async () => {
    const token = await getAdminToken();
    await apiPatch(token, '/users/me/game-time/confirm', {});
});

interface SeededPoll {
    lineupId: number;
    pollId: number;
    slotId: number;
    /** The proposed time of `slotId`, for the label the page renders. */
    time: Date;
}

/** A poll seeded with two proposed times — see {@link seedPollWithTwoSlots}. */
interface TwoSlotPoll extends SeededPoll {
    slotIdB: number;
    timeB: Date;
}

/** Get a valid gameId from seeded data (a poll needs a game). */
async function getFirstGameId(token: string): Promise<number> {
    const res = await fetch(`${API_BASE}/games/configured`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Failed to fetch games: ${res.status}`);
    const body = (await res.json()) as { data: { id: number }[] };
    if (!body.data?.length) throw new Error('No configured games');
    return body.data[0].id;
}

/**
 * Create a standalone poll with exactly one proposed time.
 *
 * Suggesting auto-votes the suggester YES, so the seeded row starts at
 * `data-voted="true"` — `resetToUnanswered` walks it back to the
 * not-answered baseline the anti-vote cases start from.
 */
async function seedPollWithSlot(
    token: string,
    daysOut: number,
): Promise<SeededPoll> {
    const gameId = await getFirstGameId(token);
    const createRes = await fetch(`${API_BASE}/scheduling-polls`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ gameId }),
    });
    expect(createRes.status).toBe(201);
    const poll = (await createRes.json()) as { id: number; lineupId: number };

    const when = new Date();
    when.setDate(when.getDate() + daysOut);
    when.setHours(20, 0, 0, 0);
    const suggested = (await apiPost(
        token,
        `/lineups/${poll.lineupId}/schedule/${poll.id}/suggest`,
        { proposedTime: when.toISOString() },
    )) as { id?: number; data?: { id?: number } } | null;
    const slotId = suggested?.data?.id ?? suggested?.id;
    expect(slotId).toBeTruthy();

    return { lineupId: poll.lineupId, pollId: poll.id, slotId: slotId!, time: when };
}

/**
 * A poll with TWO proposed times, so the leading card can actually move.
 *
 * ROK-1617 follow-up: every case above seeds ONE slot, which is precisely why
 * CI never caught the stranded-guard bug — with a single row the ladder never
 * reorders and no press on a SECOND slot can detach the first one's mutation
 * observer. `slotIdA` is the EARLIER time (it wins a net-score tie).
 */
async function seedPollWithTwoSlots(
    token: string,
    daysOutA: number,
    daysOutB: number,
): Promise<TwoSlotPoll> {
    const first = await seedPollWithSlot(token, daysOutA);
    const when = new Date();
    when.setDate(when.getDate() + daysOutB);
    when.setHours(20, 0, 0, 0);
    const suggested = (await apiPost(
        token,
        `/lineups/${first.lineupId}/schedule/${first.pollId}/suggest`,
        { proposedTime: when.toISOString() },
    )) as { id?: number; data?: { id?: number } } | null;
    const slotIdB = suggested?.data?.id ?? suggested?.id;
    expect(slotIdB).toBeTruthy();
    return { ...first, slotIdB: slotIdB!, timeB: when };
}

/**
 * The date half of the label a slot renders (`scheduling-slot-time.ts` →
 * `toLocaleString('en-US', …)`), e.g. `Thu, Sep 25`. The time half is left off
 * deliberately: Node and Chromium can disagree on the space before AM/PM
 * (U+202F on newer ICU), and that difference would fail a full-string match
 * for no behavioural reason.
 */
function slotDateLabel(when: Date): string {
    return when.toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
    });
}

/**
 * ROK-1247: the poll page's `useQuery` has a 15s staleTime, so a cached empty
 * fetch from a sibling test can short-circuit the render. Poll the API until
 * the server observes the poll before navigating.
 */
async function waitForPollVisible(
    token: string,
    seeded: SeededPoll,
): Promise<void> {
    await pollForCondition(
        async () => {
            const data = (await apiGet(
                token,
                `/lineups/${seeded.lineupId}/schedule/${seeded.pollId}`,
            )) as { match?: unknown } | null;
            return data?.match ? data : null;
        },
        {
            timeoutMs: 15_000,
            description: 'the seeded scheduling poll endpoint',
        },
    );
}

/** A slot's row by id. Exact `data-slot-id` — never a prefix match. */
function slotRowById(page: Page, slotId: number): Locator {
    return page.locator(
        `[data-testid="schedule-slot"][data-slot-id="${slotId}"]`,
    );
}

/** The seeded slot's row. */
function slotRow(page: Page, seeded: SeededPoll): Locator {
    return slotRowById(page, seeded.slotId);
}

/**
 * The YES control (`SchedulingSlotRow.tsx:218-234`). It has no test id; its
 * accessible name is "Vote for <time>" / "Remove vote for <time>", both of
 * which match — and neither of the NO control's two labels ("Mark … as not
 * working for you" / "… does not work for you — press to clear") does, so
 * this resolves to exactly one button in either stance.
 */
function yesToggle(row: Locator): Locator {
    return row.getByRole('button', { name: /vote for /i });
}

/** The "Doesn't work" control (`SchedulingSlotRow.tsx:124-141`). */
function noToggle(row: Locator): Locator {
    return row.getByTestId('slot-no-toggle');
}

/** Open the poll page and return the seeded slot's row, rendered. */
async function openPoll(page: Page, seeded: SeededPoll): Promise<Locator> {
    await page.goto(
        `/community-lineup/${seeded.lineupId}/schedule/${seeded.pollId}`,
    );
    await expect(page.getByTestId('scheduling-composite')).toBeVisible({
        timeout: 15_000,
    });
    const row = slotRow(page, seeded);
    await expect(row).toBeVisible({ timeout: 15_000 });
    return row;
}

/**
 * Poll the API until the viewer's own stances on the seeded poll satisfy
 * `predicate` — never `sleep`. The page is `useQuery`-backed with a staleTime,
 * so the server is the only honest witness that a press left the browser.
 */
async function waitForStances(
    token: string,
    seeded: SeededPoll,
    predicate: (stances: { yes: number[]; no: number[] }) => boolean,
    description: string,
): Promise<void> {
    await pollForCondition(
        async () => {
            const data = (await apiGet(
                token,
                `/lineups/${seeded.lineupId}/schedule/${seeded.pollId}`,
            )) as { myNoSlotIds?: number[]; myVotedSlotIds?: number[] } | null;
            const stances = {
                yes: data?.myVotedSlotIds ?? [],
                no: data?.myNoSlotIds ?? [],
            };
            return predicate(stances) ? stances : null;
        },
        { timeoutMs: 15_000, description },
    );
}

/**
 * Walk the suggester's auto-YES back to "not answered" — the third state the
 * anti-vote cases need as their baseline.
 */
async function resetToUnanswered(row: Locator): Promise<void> {
    await expect(row).toHaveAttribute('data-voted', 'true', {
        timeout: 15_000,
    });
    await yesToggle(row).click();
    await expect(row).toHaveAttribute('data-voted', 'false', {
        timeout: 10_000,
    });
    await expect(row).toHaveAttribute('data-no-voted', 'false');
    await expect(yesToggle(row)).toHaveAttribute('aria-pressed', 'false');
    await expect(noToggle(row)).toHaveAttribute('aria-pressed', 'false');
}

test.describe('Scheduling poll — anti-vote (ROK-1617)', () => {
    test.describe.configure({ timeout: 120_000 });

    test('pressing "Doesn’t work" marks the time, pressing it again clears the answer', async ({
        page,
    }) => {
        const token = await getAdminToken();
        const seeded = await seedPollWithSlot(token, 2);
        try {
            await waitForPollVisible(token, seeded);
            const row = await openPoll(page, seeded);
            await resetToUnanswered(row);

            // NOT ANSWERED → NO.
            await noToggle(row).click();
            await expect(row).toHaveAttribute('data-no-voted', 'true', {
                timeout: 10_000,
            });
            await expect(noToggle(row)).toHaveAttribute('aria-pressed', 'true');
            await expect(noToggle(row)).toHaveText('✕ Doesn’t work');
            await expect(
                row.getByRole('img', {
                    name: 'You said this time does not work',
                    exact: true,
                }),
            ).toBeVisible();
            // The other stance is NOT set — a NO is not a quiet YES.
            await expect(row).toHaveAttribute('data-voted', 'false');
            await expect(yesToggle(row)).toHaveAttribute(
                'aria-pressed',
                'false',
            );

            // NO → NOT ANSWERED: the same press clears it.
            await noToggle(row).click();
            await expect(row).toHaveAttribute('data-no-voted', 'false', {
                timeout: 10_000,
            });
            await expect(noToggle(row)).toHaveAttribute(
                'aria-pressed',
                'false',
            );
            await expect(noToggle(row)).toHaveText('Doesn’t work');
            await expect(row).toHaveAttribute('data-voted', 'false');
            await expect(yesToggle(row)).toHaveAttribute(
                'aria-pressed',
                'false',
            );
            await expect(row.getByTestId('slot-no-count')).toHaveCount(0);
        } finally {
            await apiDelete(token, `/lineups/${seeded.lineupId}`).catch(
                () => {},
            );
        }
    });

    test('a YES switches to a NO on the same slot — one stance, never both', async ({
        page,
    }) => {
        const token = await getAdminToken();
        const seeded = await seedPollWithSlot(token, 3);
        try {
            await waitForPollVisible(token, seeded);
            const row = await openPoll(page, seeded);
            await resetToUnanswered(row);

            // NOT ANSWERED → YES.
            await yesToggle(row).click();
            await expect(row).toHaveAttribute('data-voted', 'true', {
                timeout: 10_000,
            });
            await expect(yesToggle(row)).toHaveAttribute(
                'aria-pressed',
                'true',
            );
            await expect(noToggle(row)).toHaveAttribute(
                'aria-pressed',
                'false',
            );
            await expect(row).toContainText('1 vote');

            // YES → NO on the SAME slot. The yes must be given up, not kept.
            await noToggle(row).click();
            await expect(row).toHaveAttribute('data-no-voted', 'true', {
                timeout: 10_000,
            });
            await expect(noToggle(row)).toHaveAttribute('aria-pressed', 'true');
            await expect(row).toHaveAttribute('data-voted', 'false');
            await expect(yesToggle(row)).toHaveAttribute(
                'aria-pressed',
                'false',
            );
            await expect(row.getByTestId('slot-no-count')).toHaveText(
                '· 1 can’t',
                { timeout: 10_000 },
            );
        } finally {
            await apiDelete(token, `/lineups/${seeded.lineupId}`).catch(
                () => {},
            );
        }
    });

    test('a NO is not counted as a pick — the yes tally holds and the “can’t” clause appears', async ({
        page,
    }) => {
        const token = await getAdminToken();
        const seeded = await seedPollWithSlot(token, 4);
        try {
            await waitForPollVisible(token, seeded);
            const row = await openPoll(page, seeded);
            await resetToUnanswered(row);
            await expect(row).toContainText('0 votes');

            await noToggle(row).click();
            await expect(row).toHaveAttribute('data-no-voted', 'true', {
                timeout: 10_000,
            });

            // AC5: the yes count is untouched by an anti-vote...
            await expect(row).toContainText('0 votes');
            // ...and the NO is reported in its own clause, on the row...
            await expect(row.getByTestId('slot-no-count')).toHaveText(
                '· 1 can’t',
                { timeout: 10_000 },
            );
            // ...and in the SAME wording on the leader card (AC6).
            await expect(
                page.getByTestId('scheduling-leader-no-count'),
            ).toHaveText('· 1 can’t', { timeout: 10_000 });
            await expect(
                page.getByTestId('scheduling-leader-votes'),
            ).toContainText(/\b0 of \d+/, { timeout: 10_000 });
        } finally {
            await apiDelete(token, `/lineups/${seeded.lineupId}`).catch(
                () => {},
            );
        }
    });

    test('the NO survives a reload — it was committed server-side, not just cached', async ({
        page,
    }) => {
        const token = await getAdminToken();
        const seeded = await seedPollWithSlot(token, 5);
        try {
            await waitForPollVisible(token, seeded);
            const row = await openPoll(page, seeded);
            await resetToUnanswered(row);

            await noToggle(row).click();
            await expect(row).toHaveAttribute('data-no-voted', 'true', {
                timeout: 10_000,
            });

            // The page is useQuery-backed: poll the API until the server
            // reports the anti-vote before reloading, so a reload racing the
            // mutation can never be read as "the NO did not persist".
            await pollForCondition(
                async () => {
                    const data = (await apiGet(
                        token,
                        `/lineups/${seeded.lineupId}/schedule/${seeded.pollId}`,
                    )) as {
                        myNoSlotIds?: number[];
                        myVotedSlotIds?: number[];
                    } | null;
                    return data?.myNoSlotIds?.includes(seeded.slotId)
                        ? data
                        : null;
                },
                {
                    timeoutMs: 15_000,
                    description: 'the API to report the slot in myNoSlotIds',
                },
            );

            await page.reload();
            const reloaded = slotRow(page, seeded);
            await expect(reloaded).toHaveAttribute('data-no-voted', 'true', {
                timeout: 15_000,
            });
            await expect(noToggle(reloaded)).toHaveAttribute(
                'aria-pressed',
                'true',
            );
            await expect(reloaded).toHaveAttribute('data-voted', 'false');
            await expect(reloaded.getByTestId('slot-no-count')).toHaveText(
                '· 1 can’t',
            );
        } finally {
            await apiDelete(token, `/lineups/${seeded.lineupId}`).catch(
                () => {},
            );
        }
    });

    /**
     * ROK-1617 follow-up — the operator's "undoing an anti vote doesn't
     * recalculate the lead time".
     *
     * One mutation observer serves the whole ladder while the in-flight guard
     * is per SLOT, so a press on ANOTHER time mid-flight detached the first
     * press's mutation: its mutate-level `onSettled` never ran, its slot id
     * stayed in the pending set forever, and every later press on that slot
     * was dropped with no request at all. The cases above cannot see it —
     * they seed ONE slot, so there is no second slot to press and no leader to
     * move. This one seeds two.
     */
    test('undoing a “Doesn’t work” still recalculates the leader after a press on another time', async ({
        page,
    }) => {
        const token = await getAdminToken();
        const seeded = await seedPollWithTwoSlots(token, 6, 7);
        try {
            await waitForPollVisible(token, seeded);
            await page.goto(
                `/community-lineup/${seeded.lineupId}/schedule/${seeded.pollId}`,
            );
            await expect(page.getByTestId('scheduling-composite')).toBeVisible({
                timeout: 15_000,
            });
            const rowA = slotRowById(page, seeded.slotId);
            const rowB = slotRowById(page, seeded.slotIdB);
            await expect(rowA).toBeVisible({ timeout: 15_000 });
            await expect(rowB).toBeVisible();

            // Baseline: suggesting auto-votes YES, so walk the EARLIER time (A)
            // back to unanswered. B then leads on net score (1 vs 0).
            await resetToUnanswered(rowA);
            const leader = page.getByTestId('scheduling-leader-time');
            await expect(leader).toContainText(slotDateLabel(seeded.timeB), {
                timeout: 10_000,
            });

            // THE REPRODUCTION: press "Doesn’t work" on A and press B while
            // that first write is still in flight.
            await noToggle(rowA).click();
            await yesToggle(rowB).click();
            await waitForStances(
                token,
                seeded,
                (s) =>
                    s.no.includes(seeded.slotId) &&
                    !s.yes.includes(seeded.slotIdB),
                'the API to report the NO on slot A and the cleared vote on slot B',
            );
            // A is net −1, B is net 0 — B still leads.
            await expect(leader).toContainText(slotDateLabel(seeded.timeB), {
                timeout: 10_000,
            });

            // THE UNDO — the press the operator reported as doing nothing.
            await noToggle(rowA).click();
            await waitForStances(
                token,
                seeded,
                (s) => !s.no.includes(seeded.slotId),
                'the API to drop the anti-vote row for slot A',
            );
            await expect(rowA).toHaveAttribute('data-no-voted', 'false', {
                timeout: 10_000,
            });

            // Both times are net 0 now and A is the earlier one, so the leading
            // card MUST swing back to A. Under the bug the undo never left the
            // browser and the card stayed on B.
            await expect(leader).toContainText(slotDateLabel(seeded.time), {
                timeout: 10_000,
            });
        } finally {
            await apiDelete(token, `/lineups/${seeded.lineupId}`).catch(
                () => {},
            );
        }
    });
});
