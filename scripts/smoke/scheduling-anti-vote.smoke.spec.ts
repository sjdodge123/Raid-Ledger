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
import { test, expect } from './base';
import {
    getAdminToken,
    apiDelete,
    apiGet,
    apiPatch,
    pollForCondition,
} from './api-helpers';
import {
    noToggle,
    openPoll,
    resetToUnanswered,
    seedFixtureVoter,
    seedPollWithSlot,
    seedPollWithTwoSlots,
    slotDateLabel,
    slotRow,
    slotRowById,
    voteAs,
    waitForPollVisible,
    waitForSlotCounts,
    waitForStances,
    yesToggle,
} from './scheduling-poll-fixtures';

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

    /**
     * AC5 + AC6, re-seeded for the LEADER FLOOR.
     *
     * The poll has ONE time (A). Every row is `yes / no → net`, and "leads?"
     * is `leadsAtAll` (net > 0) fed by the shared sort:
     *
     *   step                              | A            | leader
     *   ----------------------------------|--------------|--------
     *   admin suggests A (auto-YES)       | 1 / 0 → +1   | A
     *   fixture voters 2 + 3 vote YES     | 3 / 0 → +3   | A
     *   admin clears their own YES        | 2 / 0 → +2   | A
     *   admin presses “Doesn’t work”      | 2 / 1 → +1   | A
     *
     * The last row is the assertion: the anti-vote must not move the yes
     * tally (AC5) and the card must word the NO exactly as the row does
     * (AC6) — both only observable while A still LEADS. This case used to run
     * at 0 yes / 1 no, i.e. net −1, which `leadsAtAll` now refuses to crown,
     * so the leader card would render its empty state and both AC6
     * assertions would resolve to zero elements. The two seeded YES voters
     * are what keep those same assertions reachable; the only thing that
     * changed is the tally constant (0 → 2).
     */
    test('a NO is not counted as a pick — the yes tally holds and the “can’t” clause appears', async ({
        page,
    }) => {
        const token = await getAdminToken();
        const seeded = await seedPollWithSlot(token, 4);
        try {
            const second = await seedFixtureVoter(token, 2);
            const third = await seedFixtureVoter(token, 3);
            await voteAs(second.jwt, seeded, seeded.slotId);
            await voteAs(third.jwt, seeded, seeded.slotId);
            await waitForSlotCounts(token, seeded, seeded.slotId, {
                yes: 3,
                no: 0,
            });
            await waitForPollVisible(token, seeded);
            const row = await openPoll(page, seeded);
            await resetToUnanswered(row);
            await expect(row).toContainText('2 votes');

            await noToggle(row).click();
            await expect(row).toHaveAttribute('data-no-voted', 'true', {
                timeout: 10_000,
            });

            // AC5: the yes count is untouched by an anti-vote...
            await expect(row).toContainText('2 votes');
            // ...and the NO is reported in its own clause, on the row...
            await expect(row.getByTestId('slot-no-count')).toHaveText(
                '· 1 can’t',
                { timeout: 10_000 },
            );
            // ...and in the SAME wording on the leader card (AC6), which is
            // still A because 2 yes − 1 no is net +1.
            await expect(
                page.getByTestId('scheduling-leader-no-count'),
            ).toHaveText('· 1 can’t', { timeout: 10_000 });
            await expect(
                page.getByTestId('scheduling-leader-votes'),
            ).toContainText(/\b2 of \d+/, { timeout: 10_000 });
            await expect(
                page.getByTestId('scheduling-leader-time'),
            ).toContainText(slotDateLabel(seeded.time));
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
     *
     * RE-SEEDED FOR THE LEADER FLOOR. `leadsAtAll` (net > 0) means a time at
     * net 0 is no longer crowned, and the original shape ran the whole case at
     * net 0 / net 0 — its final assertion could not hold. One extra supporter
     * (fixture slot 4) voting YES on BOTH times lifts every step above the
     * floor without changing which time leads at any step:
     *
     *   step                                   | A (earlier) | B (later)  | leader
     *   ---------------------------------------|-------------|------------|-------
     *   admin suggests A then B (auto-YES)     | 1/0 → +1    | 1/0 → +1   | A (tie → earliest)
     *   fixture voter 4 votes YES on both      | 2/0 → +2    | 2/0 → +2   | A (tie → earliest)
     *   admin clears own YES on A (baseline)   | 1/0 → +1    | 2/0 → +2   | B
     *   admin NO on A, clears own YES on B     | 1/1 →  0    | 1/0 → +1   | B  (A is now below the floor)
     *   admin UNDOES the NO on A               | 1/0 → +1    | 1/0 → +1   | A (tie → earliest)
     *
     * Every leader above is net > 0, so the card never falls to its empty
     * state mid-case, and the closing assertion — the leader swings back to
     * A — is a genuine tie broken by the earliest time, exactly the rule
     * `compareSchedulingSlots` implements. Under the bug the undo never left
     * the browser and the card stayed on B.
     */
    test('undoing a “Doesn’t work” still recalculates the leader after a press on another time', async ({
        page,
    }) => {
        const token = await getAdminToken();
        const seeded = await seedPollWithTwoSlots(token, 6, 7);
        try {
            // ONE seeded supporter, on BOTH times — see the table above.
            const second = await seedFixtureVoter(token, 4);
            await voteAs(second.jwt, seeded, seeded.slotId);
            await voteAs(second.jwt, seeded, seeded.slotIdB);
            await waitForSlotCounts(token, seeded, seeded.slotId, {
                yes: 2,
                no: 0,
            });
            await waitForSlotCounts(token, seeded, seeded.slotIdB, {
                yes: 2,
                no: 0,
            });
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
            // back to unanswered. B then leads on net score (+2 vs +1).
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
            // A is net 0 (1 yes / 1 no — below the floor), B is net +1, so B
            // still leads and the card still HAS a leader to name.
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

            // Both times are net +1 now and A is the earlier one, so the
            // leading card MUST swing back to A. Under the bug the undo never
            // left the browser and the card stayed on B.
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
