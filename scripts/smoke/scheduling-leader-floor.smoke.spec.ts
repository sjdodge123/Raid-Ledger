/**
 * The scheduling poll's LEADER FLOOR + the leading card's own vote controls
 * (ROK-1617 item D, operator ruling "No time worked").
 *
 * `leadsAtAll` (`packages/contract/src/scheduling-slot-order.ts`) is the ONE
 * predicate the expiry DM, Rally and this card gate on:
 *
 *     net score = yes − no;  a slot leads only when net > 0
 *
 * so net < 0 never leads, and **net 0 does not lead either** (ruling D-Q1: a
 * tie of yes and no is not a mandate). The one exception lives in
 * `deriveSchedulingLeader` — a poll NOBODY has answered keeps its provisional
 * top slot, which is the card's "No votes yet" state. Every case below drives
 * an ANSWERED poll, so the floor applies.
 *
 *   1. net negative      — 0 yes / 1 no ⇒ the card names no time
 *   2. net zero (D-Q1)   — 1 yes / 1 no on the top time, nothing above 0
 *                          anywhere ⇒ still no leader
 *   3. card controls     — the operator's ask: answer the leading time from
 *                          the card itself, and reach the controls on a phone
 *
 * Every test seeds its OWN poll and deletes it in `finally`.
 *
 * `deriveSchedulingLeader` also ranks FUTURE times only (review item 3, to
 * match the server's `pickLeadingFutureSlot`), falling back to every slot when
 * none is ahead. Every time seeded here is days +8…+11, so the pool is always
 * the full slot list and each table below is unaffected.
 *
 * Runs unskipped in every viewport project (desktop / mobile / tablet).
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './base';
import { getAdminToken, apiDelete, apiPatch } from './api-helpers';
import {
    noToggle,
    openPoll,
    openPollPage,
    resetToUnanswered,
    seedFixtureVoter,
    seedPollWithSlot,
    seedPollWithTwoSlots,
    slotDateLabel,
    slotRowById,
    voteAs,
    waitForPollVisible,
    waitForSlotCounts,
    waitForStances,
    yesToggle,
    type SeededPoll,
} from './scheduling-poll-fixtures';

/**
 * On a phone layout the "confirm your game time" sheet UNMOUNTS the slot list
 * (`SchedulingComposite.tsx`), and it opens whenever the viewer's game time
 * has never been confirmed — which is every fresh CI database until some OTHER
 * spec happens to stamp it, so these cases would otherwise pass or fail by
 * shard composition (ROK-1617). Confirm it server-side, up front.
 */
test.beforeAll(async () => {
    const token = await getAdminToken();
    await apiPatch(token, '/users/me/game-time/confirm', {});
});

/** The leading card itself — present in BOTH its states. */
function leaderCard(page: Page): Locator {
    return page.getByTestId('scheduling-leader-card');
}

/**
 * Assert the card is in its no-leader state: the empty-state copy from
 * `SchedulingLeaderCard.tsx::NoLeaderBody` (the `hasSlots` branch — times
 * exist, none of them clears the floor), and NO named time.
 */
async function expectNoLeader(page: Page): Promise<void> {
    await expect(
        leaderCard(page).getByText('No time works for the group yet.'),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('scheduling-leader-time')).toHaveCount(0);
    await expect(page.getByTestId('scheduling-leader-votes')).toHaveCount(0);
    await expect(page.getByTestId('scheduling-leader-no-count')).toHaveCount(0);
}

/**
 * Assert `control` is reachable without a horizontal scroll: its box sits
 * inside the viewport's width. The operator's ask is specifically about a
 * 390px phone; the `mobile` project (Pixel 5, 393px) is the one that would
 * catch a control pushed off-canvas, and reading the width from the project
 * keeps the same assertion meaningful on desktop and tablet.
 *
 * Sub-pixel layout rounding makes an exact `<= width` comparison a coin flip,
 * hence the 1px tolerance — a control that overflows does so by tens of px.
 *
 * The two controls share ONE `grid-cols-2` row (review item 1: stacking them
 * would have pushed the deadline banner out of the 375×667 fold that
 * `scheduling-poll.smoke.spec.ts` pins), so each column is roughly half the
 * card — this is the assertion that would catch a label forcing that row wider
 * than the phone.
 */
async function expectWithinViewport(
    page: Page,
    control: Locator,
): Promise<void> {
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeVisible();
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
}

/** The leading card's YES control (ROK-1617 item E — operator ask). */
function leaderVote(page: Page): Locator {
    return page.getByTestId('scheduling-leader-vote');
}

/** The leading card's "Doesn't work" control (ROK-1617 item E). */
function leaderNo(page: Page): Locator {
    return page.getByTestId('scheduling-leader-no');
}

/** Delete the seeded poll's lineup; never let cleanup fail a test. */
async function cleanup(token: string, seeded: SeededPoll): Promise<void> {
    await apiDelete(token, `/lineups/${seeded.lineupId}`).catch(() => {});
}

test.describe('Scheduling poll — leader floor (ROK-1617 item D)', () => {
    test.describe.configure({ timeout: 120_000 });

    /**
     * NET NEGATIVE. One time, one member:
     *
     *   step                        | A          | leader
     *   ----------------------------|------------|--------
     *   admin suggests A (auto-YES) | 1/0 → +1   | A
     *   admin clears their own YES  | 0/0 →  0   | A  (nobody has answered —
     *                               |            |     the "No votes yet" state)
     *   admin presses “Doesn’t work”| 0/1 → −1   | none
     *
     * The last row is the ruling: once the poll HAS an answer, a time more
     * members rejected than picked is not "leading" at any score below +1.
     */
    test('a time nobody wants does not lead — the card names no time', async ({
        page,
    }) => {
        const token = await getAdminToken();
        const seeded = await seedPollWithSlot(token, 8);
        try {
            await waitForPollVisible(token, seeded);
            const row = await openPoll(page, seeded);
            await resetToUnanswered(row);

            await noToggle(row).click();
            await waitForStances(
                token,
                seeded,
                (s) => s.no.includes(seeded.slotId),
                'the API to report the anti-vote on the only slot',
            );
            await expect(row).toHaveAttribute('data-no-voted', 'true', {
                timeout: 10_000,
            });

            // The time is still PROPOSED — it just does not lead. Pin both
            // halves, so a blank page cannot pass this case.
            await expect(row.getByTestId('slot-no-count')).toHaveText(
                '· 1 can’t',
                { timeout: 10_000 },
            );
            await expect(row).toContainText('0 votes');
            await expectNoLeader(page);
        } finally {
            await cleanup(token, seeded);
        }
    });

    /**
     * NET ZERO — ruling D-Q1, "a tie of yes and no is not a mandate".
     *
     *   step                                  | A (earlier) | B (later) | leader
     *   --------------------------------------|-------------|-----------|-------
     *   admin suggests A then B (auto-YES)    | 1/0 → +1    | 1/0 → +1  | A
     *   fixture voter 5 votes YES on A        | 2/0 → +2    | 1/0 → +1  | A
     *   admin clears own YES on A             | 1/0 → +1    | 1/0 → +1  | A
     *   admin presses “Doesn’t work” on A     | 1/1 →  0    | 1/0 → +1  | B
     *   admin clears own YES on B             | 1/1 →  0    | 0/0 →  0  | none
     *
     * The top time ends on ONE yes and ONE no — the shape the ruling is about,
     * not merely an unanswered slot — and every other time is at 0. Flip
     * `leadsAtAll` to `>= 0` and this case goes red on the empty state.
     */
    test('a time with as many “no” as “yes” does not lead either (D-Q1)', async ({
        page,
    }) => {
        const token = await getAdminToken();
        const seeded = await seedPollWithTwoSlots(token, 9, 10);
        try {
            const supporter = await seedFixtureVoter(token, 5);
            await voteAs(supporter.jwt, seeded, seeded.slotId);
            await waitForSlotCounts(token, seeded, seeded.slotId, {
                yes: 2,
                no: 0,
            });
            await waitForPollVisible(token, seeded);
            await openPollPage(page, seeded);
            const rowA = slotRowById(page, seeded.slotId);
            const rowB = slotRowById(page, seeded.slotIdB);
            await expect(rowA).toBeVisible({ timeout: 15_000 });
            await expect(rowB).toBeVisible();

            await resetToUnanswered(rowA);
            await noToggle(rowA).click();
            await waitForStances(
                token,
                seeded,
                (s) => s.no.includes(seeded.slotId),
                'the API to report the anti-vote on slot A',
            );
            // B is still net +1 here, so the card still names a time.
            await expect(
                page.getByTestId('scheduling-leader-time'),
            ).toContainText(slotDateLabel(seeded.timeB), { timeout: 10_000 });

            await yesToggle(rowB).click();
            await waitForStances(
                token,
                seeded,
                (s) =>
                    !s.yes.includes(seeded.slotIdB) &&
                    s.no.includes(seeded.slotId),
                'the API to drop the YES on slot B while the NO on A stands',
            );

            // A holds a REAL yes and a REAL no — 1 each — and is the top slot
            // by the shared sort. Net 0 is still not a mandate.
            await expect(rowA).toContainText('1 vote');
            await expect(rowA.getByTestId('slot-no-count')).toHaveText(
                '· 1 can’t',
                { timeout: 10_000 },
            );
            await expectNoLeader(page);
        } finally {
            await cleanup(token, seeded);
        }
    });

    /**
     * The operator's ask: answer the LEADING time from the card, without
     * hunting for its row in the ladder — and reach the controls on a phone.
     *
     *   step                                | A          | leader
     *   ------------------------------------|------------|--------
     *   admin suggests A (auto-YES)         | 1/0 → +1   | A
     *   fixture voters 6 + 7 vote YES       | 3/0 → +3   | A
     *   admin presses the card's NO         | 2/1 → +1   | A
     *   admin presses the card's NO again   | 2/0 → +2   | A
     *
     * Two seeded supporters are load-bearing: with one, the NO press would
     * drop A to net 0, the floor would hide the card, and the control under
     * test would unmount before the second press — the case would fail for a
     * reason that has nothing to do with the control.
     *
     * The card's ballot (`scheduling-leader-vote` / `scheduling-leader-no`)
     * SHIPPED with this story, so the ids below exist. Two properties of that
     * implementation this case leans on, both pinned by vitest as well:
     *
     *   - the ballot is ONE row of two equal columns rendered LAST in the card
     *     (below the deadline banner), so it adds nothing above the banner and
     *     each column is ~171px at 390 — hence `expectWithinViewport` rather
     *     than a fixed-width expectation;
     *   - while a press made ON the card is in flight the controls stay bound
     *     to the slot that was pressed. Here that slot keeps leading anyway
     *     (+1), so the binding only has to not move — asserted below on the
     *     control's accessible name after the first press.
     */
    test('the leading card answers for the leading time — and its controls fit a phone', async ({
        page,
    }) => {
        const token = await getAdminToken();
        const seeded = await seedPollWithSlot(token, 11);
        try {
            const second = await seedFixtureVoter(token, 6);
            const third = await seedFixtureVoter(token, 7);
            await voteAs(second.jwt, seeded, seeded.slotId);
            await voteAs(third.jwt, seeded, seeded.slotId);
            await waitForSlotCounts(token, seeded, seeded.slotId, {
                yes: 3,
                no: 0,
            });
            await waitForPollVisible(token, seeded);
            const row = await openPoll(page, seeded);

            await expect(
                page.getByTestId('scheduling-leader-time'),
            ).toContainText(slotDateLabel(seeded.time), { timeout: 10_000 });
            await expect(
                page.getByTestId('scheduling-leader-votes'),
            ).toContainText(/\b3 of \d+/);

            // Both controls are ON the card and inside the viewport — at
            // 390-ish px that is the whole point of the ask.
            await expectWithinViewport(page, leaderVote(page));
            await expectWithinViewport(page, leaderNo(page));

            // YES → NO, from the card.
            await leaderNo(page).click();
            await waitForStances(
                token,
                seeded,
                (s) =>
                    s.no.includes(seeded.slotId) &&
                    !s.yes.includes(seeded.slotId),
                'the API to report the viewer’s stance on the leading slot as no',
            );
            await expect(row).toHaveAttribute('data-no-voted', 'true', {
                timeout: 10_000,
            });
            await expect(row).toHaveAttribute('data-voted', 'false');
            // The card follows the press: still leading (2 − 1 = +1), one
            // fewer picker, and the anti-vote clause appears.
            await expect(
                page.getByTestId('scheduling-leader-votes'),
            ).toContainText(/\b2 of \d+/, { timeout: 10_000 });
            await expect(
                page.getByTestId('scheduling-leader-no-count'),
            ).toHaveText('· 1 can’t', { timeout: 10_000 });
            await expect(
                page.getByTestId('scheduling-leader-time'),
            ).toContainText(slotDateLabel(seeded.time));
            // The control still ANSWERS the time it was pressed on — every
            // accessible name on the ballot carries its slot's time, so a
            // re-target would show up here before the second press lands on
            // the wrong slot.
            expect(await leaderNo(page).getAttribute('aria-label')).toContain(
                slotDateLabel(seeded.time),
            );

            // NO → NOT ANSWERED: the same control clears it, and the viewer's
            // stance row disappears server-side (clearing a no does NOT
            // restore the yes, so the tally stays at 2).
            await leaderNo(page).click();
            await waitForStances(
                token,
                seeded,
                (s) =>
                    !s.no.includes(seeded.slotId) &&
                    !s.yes.includes(seeded.slotId),
                'the API to drop the viewer’s stance row for the leading slot',
            );
            await expect(row).toHaveAttribute('data-no-voted', 'false', {
                timeout: 10_000,
            });
            await expect(
                page.getByTestId('scheduling-leader-no-count'),
            ).toHaveCount(0);
            await expect(
                page.getByTestId('scheduling-leader-votes'),
            ).toContainText(/\b2 of \d+/, { timeout: 10_000 });
            await expect(
                page.getByTestId('scheduling-leader-time'),
            ).toContainText(slotDateLabel(seeded.time));
            await expectWithinViewport(page, leaderVote(page));
        } finally {
            await cleanup(token, seeded);
        }
    });
});
