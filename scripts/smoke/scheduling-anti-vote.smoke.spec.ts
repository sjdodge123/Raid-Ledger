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
    expectUnanswered,
    leaderNoToggle,
    leaderYesToggle,
    noToggle,
    nonLeadingRow,
    openPollPage,
    seedFixtureVoter,
    seedNonLeadingRowPoll,
    seedPollWithTwoSlots,
    slotDateLabel,
    slotRowById,
    voteAs,
    waitForPollVisible,
    waitForSlotCounts,
    waitForStances,
    yesToggle,
} from './scheduling-poll-fixtures';

/**
 * ROK-1635 AC1 — the LEADING time renders once, on the card, and its ladder
 * ROW is gone (`SchedulingComposite.tsx` → `excludeSlotId={leaderSlotId}`).
 * Every case below needs a row it can press, so none of them may seed a poll
 * whose slot-under-test leads — and a one-slot poll ALWAYS leads, in every
 * stance, because an unanswered poll keeps a provisional leader. Hence
 * `seedNonLeadingRowPoll`: slot A holds the lead and has no row, slot B (the
 * one under test) sits at net 0 and is the row the ladder renders. Where a
 * case is genuinely about answering the WINNING time, it presses the card's
 * own ballot (`leaderYesToggle` / `leaderNoToggle`) instead — the control that
 * replaced that row. Stance semantics are untouched by this story.
 */

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
        const seeded = await seedNonLeadingRowPoll(token, 2, 3);
        try {
            await waitForPollVisible(token, seeded);
            await openPollPage(page, seeded);
            const row = nonLeadingRow(page, seeded);
            await expect(row).toBeVisible({ timeout: 15_000 });
            await expectUnanswered(row);

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
        const seeded = await seedNonLeadingRowPoll(token, 3, 4);
        try {
            await waitForPollVisible(token, seeded);
            await openPollPage(page, seeded);
            const row = nonLeadingRow(page, seeded);
            await expect(row).toBeVisible({ timeout: 15_000 });
            await expectUnanswered(row);

            // NOT ANSWERED → YES. B reaches net +1, level with A — and A is
            // the earlier time, so it keeps the lead and B keeps its row.
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
     * AC5 + AC6, re-seeded for the LEADER FLOOR and then for ROK-1635 AC1.
     *
     * AC5 is "an anti-vote does not move the yes tally"; AC6 is "the row and
     * the leading card word the NO identically". The floor rewrite proved both
     * on ONE time, which ROK-1635 makes impossible: the leading time has no
     * row, so a single slot can be read on the card or in the ladder, never in
     * both. The two claims are therefore made on two times of the SAME poll —
     * the ladder half on B, the card half on A — which is what "identical
     * wording on both surfaces" actually asserts anyway. Neither assertion is
     * weakened; the anti-vote wording (`· 1 can’t`) and the untouched yes
     * tally are still pinned on both surfaces.
     *
     *   step                                   | A (earlier) | B (later)  | leader
     *   ---------------------------------------|-------------|------------|-------
     *   admin suggests A then B (auto-YES)     | 1/0 → +1    | 1/0 → +1   | A
     *   seed drops admin's YES on B            | 1/0 → +1    | 0/0 →  0   | A
     *   fixture voters 2 + 3 vote YES on both  | 3/0 → +3    | 2/0 → +2   | A
     *   admin presses “Doesn’t work” on B's ROW| 3/0 → +3    | 2/1 → +1   | A
     *   admin presses the CARD's “Doesn’t work”| 2/1 → +1    | 2/1 → +1   | A (tie → earliest)
     *
     * A leads at every step, so B keeps its row the whole way through and the
     * card never falls to its empty state. The row press comes FIRST on
     * purpose: pressing the card first would drop A to +1 under B's +2 and
     * swap which row exists mid-case.
     */
    test('a NO is not counted as a pick — the yes tally holds and the “can’t” clause appears', async ({
        page,
    }) => {
        const token = await getAdminToken();
        const seeded = await seedNonLeadingRowPoll(token, 4, 5);
        try {
            const second = await seedFixtureVoter(token, 2);
            const third = await seedFixtureVoter(token, 3);
            for (const voter of [second, third]) {
                await voteAs(voter.jwt, seeded, seeded.slotId);
                await voteAs(voter.jwt, seeded, seeded.slotIdB);
            }
            await waitForSlotCounts(token, seeded, seeded.slotId, {
                yes: 3,
                no: 0,
            });
            await waitForSlotCounts(token, seeded, seeded.slotIdB, {
                yes: 2,
                no: 0,
            });
            await waitForPollVisible(token, seeded);
            await openPollPage(page, seeded);
            const row = nonLeadingRow(page, seeded);
            await expect(row).toBeVisible({ timeout: 15_000 });
            await expectUnanswered(row);
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

            // ...and in the SAME wording on the leading card (AC6). The card
            // answers for A, whose auto-YES the admin still holds, so this one
            // press is the same yes→no switch the row just made.
            await expect(
                page.getByTestId('scheduling-leader-time'),
            ).toContainText(slotDateLabel(seeded.time), { timeout: 10_000 });
            await leaderNoToggle(page).click();
            await waitForStances(
                token,
                seeded,
                (s) =>
                    s.no.includes(seeded.slotId) &&
                    !s.yes.includes(seeded.slotId),
                'the API to report the viewer’s NO on the leading slot A',
            );
            await expect(
                page.getByTestId('scheduling-leader-no-count'),
            ).toHaveText('· 1 can’t', { timeout: 10_000 });
            await expect(
                page.getByTestId('scheduling-leader-votes'),
            ).toContainText(/\b2 of \d+/, { timeout: 10_000 });
            // A is level with B on net score now, and it is the earlier time,
            // so the card must still be naming A.
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
        const seeded = await seedNonLeadingRowPoll(token, 5, 6);
        try {
            await waitForPollVisible(token, seeded);
            await openPollPage(page, seeded);
            const row = nonLeadingRow(page, seeded);
            await expect(row).toBeVisible({ timeout: 15_000 });
            await expectUnanswered(row);

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
                    return data?.myNoSlotIds?.includes(seeded.slotIdB)
                        ? data
                        : null;
                },
                {
                    timeoutMs: 15_000,
                    description: 'the API to report the slot in myNoSlotIds',
                },
            );

            await page.reload();
            const reloaded = nonLeadingRow(page, seeded);
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
     * RE-SEEDED FOR THE LEADER FLOOR, then RE-TARGETED FOR ROK-1635 AC1.
     * `leadsAtAll` (net > 0) means a time at net 0 is no longer crowned, so
     * one extra supporter (fixture slot 4) voting YES on BOTH times keeps
     * every step above the floor. AC1 then removes the LEADING time's row, so
     * the press that used to land on the leader's row lands on the card's own
     * ballot instead — the surface that replaced it. That is not a softer
     * reproduction: the card's controls are bound to the SAME ladder handlers
     * (`SchedulingLeaderVoteControls.tsx` — "one component… no second mutation
     * path"), so "a press on ANOTHER time while the first is in flight" is
     * exactly what still happens.
     *
     *   step                                   | A (earlier) | B (later)  | leader | pressed
     *   ---------------------------------------|-------------|------------|--------|--------
     *   admin suggests A then B (auto-YES)     | 1/0 → +1    | 1/0 → +1   | A      | —
     *   fixture voter 4 votes YES on both      | 2/0 → +2    | 2/0 → +2   | A      | —
     *   admin clears own YES on A (baseline)   | 1/0 → +1    | 2/0 → +2   | B      | CARD (A leads)
     *   admin NO on A, clears own YES on B     | 1/1 →  0    | 1/0 → +1   | B      | ROW A, then CARD (B leads)
     *   admin UNDOES the NO on A               | 1/0 → +1    | 1/0 → +1   | A      | ROW A
     *
     * Every leader above is net > 0, so the card never falls to its empty
     * state mid-case, and the closing assertion — the leader swings back to
     * A — is a genuine tie broken by the earliest time, exactly the rule
     * `compareSchedulingSlots` implements. Under the bug the undo never left
     * the browser and the card stayed on B.
     *
     * A's row only exists while A is NOT leading, which is every step except
     * the last; the final "the undo landed" assertion therefore reads the
     * card (now bound to A) rather than the row that AC1 just removed. Both
     * times are in the FUTURE (fixture days +6 / +7), so the future-only
     * leader filter (review item 3) changes no row of the table.
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
            await openPollPage(page, seeded);
            const rowA = slotRowById(page, seeded.slotId);
            const rowB = slotRowById(page, seeded.slotIdB);
            const leader = page.getByTestId('scheduling-leader-time');
            // A leads on the tiebreak, so AC1 has taken its row: only B is in
            // the ladder, and the card answers for A.
            await expect(rowB).toBeVisible({ timeout: 15_000 });
            await expect(rowA).toHaveCount(0);
            await expect(leader).toContainText(slotDateLabel(seeded.time), {
                timeout: 10_000,
            });

            // Baseline: suggesting auto-votes YES, so walk the EARLIER time (A)
            // back to unanswered — from the CARD, the only surface that still
            // answers for A. B then leads on net score (+2 vs +1), and the two
            // rows swap: A gains one, B loses its.
            await leaderYesToggle(page).click();
            await waitForStances(
                token,
                seeded,
                (s) => !s.yes.includes(seeded.slotId),
                'the API to drop the viewer’s YES on slot A',
            );
            await expect(leader).toContainText(slotDateLabel(seeded.timeB), {
                timeout: 10_000,
            });
            await expect(rowA).toBeVisible({ timeout: 10_000 });

            // THE REPRODUCTION: press "Doesn’t work" on A's row and press the
            // card — which now answers for B — while that first write is still
            // in flight. Both presses go through the ladder's ONE mutation.
            await noToggle(rowA).click();
            await leaderYesToggle(page).click();
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
            // Both times are net +1 now and A is the earlier one, so the
            // leading card MUST swing back to A. Under the bug the undo never
            // left the browser and the card stayed on B.
            await expect(leader).toContainText(slotDateLabel(seeded.time), {
                timeout: 10_000,
            });
            // ...and the undo is rendered as "not answered" on the surface
            // that now owns A. This used to read A's ROW; AC1 removes that row
            // the instant A takes the lead, so the card's own ballot — bound
            // to A, same stance, same component — carries the assertion.
            await expect(rowA).toHaveCount(0);
            await expect(leaderNoToggle(page)).toHaveAttribute(
                'aria-pressed',
                'false',
            );
            await expect(leaderYesToggle(page)).toHaveAttribute(
                'aria-pressed',
                'false',
            );
        } finally {
            await apiDelete(token, `/lineups/${seeded.lineupId}`).catch(
                () => {},
            );
        }
    });
});
