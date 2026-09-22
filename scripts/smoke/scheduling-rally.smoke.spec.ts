/**
 * Leader-card "Poll actions ⋯" menu — ROK-1618.
 *
 * The lock that ends a poll used to be a full-width bar floating in the
 * toolbar (`sticky-hero-lock-poll`). It now lives in a ⋯ menu ON the leader
 * card that names the time it locks, beside the new Rally nudge. These cases
 * drive that menu in a real browser on a freshly seeded standalone poll:
 *
 *   1. AC5 — the floating lock is GONE and the ⋯ trigger is inside the card
 *   2. AC5/AC7 — the menu opens, both items are reachable, the trigger is a
 *                44×44 touch target, and exactly one container is used
 *                (desktop popover vs phone/tablet sheet, branched at runtime)
 *   3. AC8 — when every member has answered the LEADING time Rally is
 *            present, DISABLED, and says "Everyone has answered this time" —
 *            it is never silently missing
 *   4. AC5 — the menu's Lock opens the SAME lock-in confirm the per-row
 *            button opens; the case CANCELS, it never locks the poll in
 *   5. ROK-1635 AC3 — the ladder's inline "Lock this time →" is GONE; a row's
 *            Lock is the first item of the same ⋯ menu, on the row of a time
 *            that is NOT leading (a leading time has no row, AC1)
 *   5b. ROK-1635 §3.2/§3.4 — Rally from a row sends THAT row's `slotId`, and
 *            the one 6h poll cooldown it arms shows on every menu
 *   6. Escape closes the menu and returns focus to the trigger; on the sheet
 *            the title row's "Close sheet" control does the same
 *
 * NOT covered here (deliberate): the "Nudged N members" success path. The
 * rally's audience is resolved server-side and excludes members younger than
 * `POLL_NUDGE_MIN_MEMBER_AGE_HOURS` (24h), so a member added by a smoke
 * fixture seconds earlier can never be nudged — a browser case for it would
 * have to fake the audience. That path is pinned by
 * `api/src/lineups/scheduling/scheduling-rally.integration.spec.ts` instead.
 *
 * Every test seeds its OWN poll and deletes it in `finally` — a shared poll
 * mutated by a neighbouring case produced a one-shard flake in the sibling
 * anti-vote suite (ROK-1617).
 *
 * Runs unskipped in every viewport project (desktop / mobile / tablet). The
 * menu switches container at `DESKTOP_MQ` (1024px), so case 2 branches on
 * which of the two test ids is VISIBLE rather than on the project name; every
 * other assertion is on role / accessible name / test id, never on position.
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
import {
    openRowMenu,
    rowMenuTrigger,
    seedFixtureVoter,
    seedPollWithTwoSlots,
    slotRowById,
    voteAs,
    waitForSlotCounts,
    type TwoSlotPoll,
} from './scheduling-poll-fixtures';

/**
 * On a phone layout the "confirm your game time" sheet UNMOUNTS the slot list
 * (`SchedulingComposite.tsx`: `{!check.sheetVisible && <SchedulingSlotList/>}`),
 * and it opens whenever the viewer's game time has never been confirmed —
 * which is every fresh CI database until some OTHER spec happens to stamp it.
 * That made the sibling anti-vote cases pass or fail by shard composition
 * (ROK-1617: 12/12 red on [mobile] in one shard, green everywhere else).
 * Case 5 reads the ladder directly, so confirm it server-side, up front.
 */
test.beforeAll(async () => {
    const token = await getAdminToken();
    await apiPatch(token, '/users/me/game-time/confirm', {});
});

interface SeededPoll {
    lineupId: number;
    pollId: number;
    slotId: number;
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
 * Suggesting auto-votes the suggester YES, so the seeded poll has a leading
 * slot with one vote from the moment it exists — which is what makes the
 * leader card's ⋯ menu render at all (`canLock && leader !== null`), and what
 * leaves AC8's Rally empty: the poll's only member has already answered the
 * LEADING time (ROK-1618 counts stances on that slot, not poll-wide votes).
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

    return { lineupId: poll.lineupId, pollId: poll.id, slotId: slotId! };
}

/** The poll payload, only the fields these cases read. */
interface PollPayload {
    match?: { members?: { userId?: number }[] };
    uniqueVoterCount?: number;
    myVotedSlotIds?: number[];
    slots?: {
        id: number;
        votes?: { userId: number }[];
        noVotes?: { userId: number }[];
    }[];
}

/**
 * ROK-1247: the poll page's `useQuery` has a 15s staleTime, so a cached empty
 * fetch from a sibling test can short-circuit the render. Poll the API until
 * the server observes the poll — AND the suggester's auto-YES — before
 * navigating, so the leader card is never read mid-write.
 */
async function waitForSeededVote(
    token: string,
    seeded: SeededPoll,
): Promise<PollPayload> {
    return pollForCondition(
        async () => {
            const data = (await apiGet(
                token,
                `/lineups/${seeded.lineupId}/schedule/${seeded.pollId}`,
            )) as PollPayload | null;
            return data?.match && data.myVotedSlotIds?.includes(seeded.slotId)
                ? data
                : null;
        },
        {
            timeoutMs: 15_000,
            description:
                'the seeded scheduling poll to report the suggester auto-vote',
        },
    );
}

/**
 * A poll with a clear leader (`slotId`, the earlier time) AND a time that is
 * certainly NOT leading (`slotIdB`) — the shape ROK-1635 AC1 forces on any
 * case that needs a ladder ROW, since the leading time no longer has one.
 *
 * Suggesting auto-votes the suggester YES, so B starts level with A; the
 * toggle below drops that vote and leaves B at net 0, which `leadsAtAll`
 * (net > 0) can never crown. The counts are read back from the API before the
 * page is opened — a navigation that beats the write renders a leader derived
 * from the wrong numbers.
 */
async function seedNonLeadingRowPoll(
    token: string,
    daysOutA: number,
    daysOutB: number,
): Promise<TwoSlotPoll> {
    const seeded = await seedPollWithTwoSlots(token, daysOutA, daysOutB);
    await apiPost(
        token,
        `/lineups/${seeded.lineupId}/schedule/${seeded.pollId}/vote`,
        { slotId: seeded.slotIdB },
    );
    await waitForSlotCounts(token, seeded, seeded.slotIdB, { yes: 0, no: 0 });
    await waitForSlotCounts(token, seeded, seeded.slotId, { yes: 1, no: 0 });
    return seeded;
}

/** The ⋯ trigger (`SchedulingLeaderMenu.tsx`), accessible name "Poll actions". */
function menuTrigger(page: Page): Locator {
    return page.getByTestId('scheduling-leader-menu');
}

/**
 * The lock-in confirm (`EarlyCreateConfirmModal.tsx`). Its copy varies with
 * the majority threshold, so it is identified by what only IT has: a modal
 * dialog carrying a "Cancel" button. The phone menu sheet is also
 * `role="dialog"`, and it stays open behind this modal — hence the filter.
 */
function lockConfirmDialog(page: Page): Locator {
    return page
        .getByRole('dialog')
        .filter({ has: page.getByRole('button', { name: 'Cancel', exact: true }) });
}

/** Open the poll page with its leader card rendered. */
async function openPoll(page: Page, seeded: SeededPoll): Promise<void> {
    await page.goto(
        `/community-lineup/${seeded.lineupId}/schedule/${seeded.pollId}`,
    );
    await expect(page.getByTestId('scheduling-composite')).toBeVisible({
        timeout: 15_000,
    });
    await expect(page.getByTestId('scheduling-leader-card')).toBeVisible({
        timeout: 15_000,
    });
}

interface OpenedMenu {
    /** The popover (≥1024px) or the bottom sheet (below) — whichever is up. */
    container: Locator;
    isSheet: boolean;
}

/**
 * Press ⋯ and resolve the container the menu actually rendered into.
 *
 * Branching on the VISIBLE test id rather than the Playwright project keeps
 * this honest: the switch belongs to `DESKTOP_MQ`, and a project whose
 * viewport moved across 1024px must not silently assert nothing.
 */
async function openLeaderMenu(page: Page): Promise<OpenedMenu> {
    const trigger = menuTrigger(page);
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    await trigger.click();
    // Both containers render this item; waiting on it means "the menu is up"
    // without first guessing which container we are in.
    await expect(page.getByTestId('scheduling-leader-rally')).toBeVisible({
        timeout: 10_000,
    });
    const sheet = page.getByTestId('scheduling-leader-menu-sheet');
    const isSheet = await sheet.isVisible();
    return {
        container: isSheet
            ? sheet
            : page.getByTestId('scheduling-leader-menu-popover'),
        isSheet,
    };
}

test.describe('Scheduling poll — leader-card Poll actions menu (ROK-1618)', () => {
    test.describe.configure({ timeout: 120_000 });

    test('the floating lock bar is gone and the ⋯ menu lives on the leader card', async ({
        page,
    }) => {
        const token = await getAdminToken();
        const seeded = await seedPollWithSlot(token, 6);
        try {
            await waitForSeededVote(token, seeded);
            await openPoll(page, seeded);

            // AC5: the old full-width toolbar lock is deleted, not hidden.
            await expect(page.getByTestId('sticky-hero-lock-poll')).toHaveCount(
                0,
            );

            // ...and the affordance that replaced it is INSIDE the card that
            // names the time it locks, not somewhere else on the page.
            const inCard = page
                .getByTestId('scheduling-leader-card')
                .getByTestId('scheduling-leader-menu');
            await expect(inCard).toBeVisible();
            await expect(inCard).toHaveAccessibleName('Poll actions');
            await expect(inCard).toHaveAttribute('aria-expanded', 'false');

            // Closed menu: neither action is reachable yet. `toBeHidden`
            // covers both containers — the desktop popover stays mounted
            // under `hidden`, the sheet is not mounted at all.
            await expect(page.getByTestId('scheduling-leader-lock')).toBeHidden();
            await expect(
                page.getByTestId('scheduling-leader-rally'),
            ).toBeHidden();
        } finally {
            await apiDelete(token, `/lineups/${seeded.lineupId}`).catch(
                () => {},
            );
        }
    });

    test('pressing ⋯ opens one container with both actions, from a 44px trigger', async ({
        page,
    }) => {
        const token = await getAdminToken();
        const seeded = await seedPollWithSlot(token, 7);
        try {
            await waitForSeededVote(token, seeded);
            await openPoll(page, seeded);

            // AC7: the trigger is a real touch target before we press it.
            const box = await menuTrigger(page).boundingBox();
            expect(box, 'the ⋯ trigger has no bounding box').not.toBeNull();
            expect(box!.width).toBeGreaterThanOrEqual(44);
            expect(box!.height).toBeGreaterThanOrEqual(44);

            const { container, isSheet } = await openLeaderMenu(page);
            await expect(menuTrigger(page)).toHaveAttribute(
                'aria-expanded',
                'true',
            );

            // AC5/AC7: both actions, and both INSIDE the one container.
            await expect(
                container.getByTestId('scheduling-leader-lock'),
            ).toBeVisible();
            await expect(
                container.getByTestId('scheduling-leader-rally'),
            ).toBeVisible();

            // Exactly one container is used — never both at once.
            if (isSheet) {
                await expect(
                    page.getByTestId('scheduling-leader-menu-popover'),
                ).toBeHidden();
                await expect(
                    page.getByTestId('scheduling-leader-menu-title'),
                ).toBeVisible();
                await expect(
                    page.getByTestId('scheduling-leader-menu-title'),
                ).toContainText('Poll actions');
            } else {
                await expect(
                    page.getByTestId('scheduling-leader-menu-sheet'),
                ).toBeHidden();
                await expect(container).toHaveAttribute('role', 'menu');
            }
        } finally {
            await apiDelete(token, `/lineups/${seeded.lineupId}`).catch(
                () => {},
            );
        }
    });

    test('AC8 — on a fully-voted poll Rally is present but disabled and says so', async ({
        page,
    }) => {
        const token = await getAdminToken();
        const seeded = await seedPollWithSlot(token, 8);
        try {
            const payload = await waitForSeededVote(token, seeded);

            // The empty state under test is "no member lacks a stance on the
            // LEADING slot" (`scheduling-manage.helpers.ts::rallyPendingCount`,
            // ROK-1618). Assert the fixture really is in that state, so a red
            // below is "the row did not disable" and never "somebody still
            // owed the leading time an answer". Deliberately STRICTER than the
            // page: the viewer is counted here although `rallyPendingCount`
            // excludes them, so 0 here guarantees 0 on the page.
            const leading = payload.slots?.find((s) => s.id === seeded.slotId);
            const answered = new Set<number>([
                ...(leading?.votes ?? []).map((v) => v.userId),
                ...(leading?.noVotes ?? []).map((v) => v.userId),
            ]);
            const pending = (payload.match?.members ?? []).filter(
                (m) => m.userId == null || !answered.has(m.userId),
            ).length;
            expect(
                pending,
                'the seeded poll should have nobody left to rally — ' +
                    `members=${String(payload.match?.members?.length)} ` +
                    `answered-on-leading=${String(answered.size)}`,
            ).toBe(0);

            await openPoll(page, seeded);
            await openLeaderMenu(page);

            // Present — AC8 is "disabled with a reason", not "hidden".
            const rally = page.getByTestId('scheduling-leader-rally');
            await expect(rally).toBeVisible();
            await expect(rally).toBeDisabled();
            await expect(rally).toHaveAccessibleName(
                /Everyone has answered this time/,
            );
        } finally {
            await apiDelete(token, `/lineups/${seeded.lineupId}`).catch(
                () => {},
            );
        }
    });

    test('the menu’s Lock opens the same lock-in confirm — and Cancel backs out', async ({
        page,
    }) => {
        const token = await getAdminToken();
        const seeded = await seedPollWithSlot(token, 9);
        try {
            await waitForSeededVote(token, seeded);
            await openPoll(page, seeded);
            const { container } = await openLeaderMenu(page);

            const lock = container.getByTestId('scheduling-leader-lock');
            await expect(lock).toHaveAccessibleName(/^Lock this time — /);
            await lock.click();

            // The confirm the per-row button opens (`useSchedulingLock`
            // → `EarlyCreateConfirmModal`), in either copy variant.
            const confirm = lockConfirmDialog(page);
            await expect(confirm).toBeVisible({ timeout: 10_000 });
            await expect(confirm).toContainText(
                /Lock in .+ for everyone\?|Create event below majority\?/,
            );

            // Back out — this case must never actually end the poll.
            await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
            await expect(confirm).toBeHidden({ timeout: 10_000 });

            // The poll is still open server-side, i.e. Cancel cancelled.
            const after = (await apiGet(
                token,
                `/lineups/${seeded.lineupId}/schedule/${seeded.pollId}`,
            )) as { lockedInTime?: string | null } | null;
            expect(after?.lockedInTime ?? null).toBeNull();
        } finally {
            await apiDelete(token, `/lineups/${seeded.lineupId}`).catch(
                () => {},
            );
        }
    });

    /**
     * ROK-1635 AC3 REVERSES ROK-1618 AC6, and this is the second of its two
     * proofs (the other is the same-named case in
     * `scheduling-poll.smoke.spec.ts`). The ladder's inline cyan
     * "Lock this time →" button is DELETED: a row's Lock is now the first item
     * of the SAME ⋯ menu the leading card carries, so there is exactly one
     * control set on the page. The intent — an operator can lock a ladder row's
     * time, and the affordance really is reachable — is preserved; it is the
     * surface that moved, so the assertion moved with it.
     */
    test('AC6 reversed — the ladder’s per-row Lock lives in that row’s ⋯ menu', async ({
        page,
    }) => {
        const token = await getAdminToken();
        const seeded = await seedNonLeadingRowPoll(token, 10, 11);
        try {
            await openPoll(page, seeded);

            // The row under test is the NON-leading time: ROK-1635 AC1 leaves
            // the leading time with no row at all, so seeding one slot (as
            // every other case in this file does) would leave nothing to press.
            const row = slotRowById(page, seeded.slotIdB);
            await expect(row).toBeVisible({ timeout: 15_000 });

            // The deletion, asserted page-wide: the menu item is a `menuitem`,
            // never a `button`, so any surviving inline lock fails here.
            await expect(
                page.getByRole('button', { name: /^Lock this time/ }),
            ).toHaveCount(0);

            // A row names its own time — N identical "Poll actions" triggers
            // on one page are unusable with a screen reader (§2.3).
            await expect(rowMenuTrigger(row)).toHaveAccessibleName(
                /^Time actions — /,
            );
            const { container, isSheet } = await openRowMenu(page, row);

            const lock = container.getByTestId('scheduling-slot-lock');
            await expect(lock).toBeVisible();
            await expect(lock).toBeEnabled();
            await expect(lock).toHaveAccessibleName(/^Lock this time — /);

            // Exactly ONE container, switched at the same DESKTOP_MQ every
            // other menu on the page uses — never both at once.
            if (isSheet) {
                await expect(
                    row.getByTestId('scheduling-slot-menu-popover'),
                ).toBeHidden();
                await expect(
                    page.getByTestId('scheduling-slot-menu-title'),
                ).toHaveText(/^Time actions — /);
            } else {
                await expect(
                    page.getByTestId('scheduling-slot-menu-sheet'),
                ).toHaveCount(0);
                await expect(container).toHaveAttribute('role', 'menu');
            }
        } finally {
            await apiDelete(token, `/lineups/${seeded.lineupId}`).catch(
                () => {},
            );
        }
    });

    /**
     * §3.2 + §3.4 — a row's Rally names ITS OWN time, and the 6h cooldown it
     * arms belongs to the POLL.
     *
     * Before ROK-1635 the server picked the rally's slot itself (always the
     * leading one) and the request carried no slot at all; an organiser who
     * wanted to nudge a different time could not. The request body is asserted
     * directly because it is the only place that difference is visible from a
     * browser — the DM itself is pinned by
     * `scheduling-rally.integration.spec.ts`.
     *
     * The second member is not decoration: the row disables itself at zero
     * pending (AC8) and the viewer is never part of their own audience, so
     * without them there would be nothing to press and nothing for the server
     * to rally.
     */
    test('Rally on a non-leading row rallies THAT time, and arms every menu on the page', async ({
        page,
    }) => {
        const token = await getAdminToken();
        const seeded = await seedNonLeadingRowPoll(token, 12, 13);
        try {
            // Voting enrols them as a poll member (open roster). They answer
            // A only, so B — the row under test — owes exactly one answer.
            const voter = await seedFixtureVoter(token, 6);
            await voteAs(voter.jwt, seeded, seeded.slotId);
            await waitForSlotCounts(token, seeded, seeded.slotId, {
                yes: 2,
                no: 0,
            });

            await openPoll(page, seeded);
            const row = slotRowById(page, seeded.slotIdB);
            await expect(row).toBeVisible({ timeout: 15_000 });
            const { container } = await openRowMenu(page, row);

            // §3.5 idle copy — "this time" is THIS row's time, not the poll's
            // leading one.
            const rally = container.getByTestId('scheduling-slot-rally');
            await expect(rally).toBeEnabled();
            await expect(rally).toHaveAccessibleName(
                /^Rally — 1 hasn't answered this time$/,
            );

            const rallyRequest = page.waitForRequest(
                (req) =>
                    req.method() === 'POST' &&
                    req.url().includes(
                        `/lineups/${seeded.lineupId}/schedule/${seeded.pollId}/rally`,
                    ),
            );
            await rally.click();

            // THE per-slot change: the row sends its own slot id, verbatim.
            expect((await rallyRequest).postDataJSON()).toEqual({
                slotId: seeded.slotIdB,
            });

            // The organiser is told what happened (§3.5 success table). Both
            // wordings are successes — which one lands depends on whether the
            // DM dispatch itself reached the seeded member.
            await expect(
                page
                    .locator('[data-sonner-toast]')
                    .filter({
                        hasText:
                            /Nudged \d+ member|Everyone left was already rallied recently/,
                    })
                    .first(),
            ).toBeVisible({ timeout: 15_000 });

            // §3.4: ONE cooldown for the whole poll. The pressed row shows it…
            await expect(rally).toHaveAccessibleName(
                /^Rallied ✓ — You can do this again in 6h$/,
                { timeout: 15_000 },
            );
            await expect(rally).toBeDisabled();

            // …and so does the leading card's menu, which was never pressed.
            // N independently-idle Rally rows the server would 429 is the bug
            // this pins.
            await page.keyboard.press('Escape');
            await openLeaderMenu(page);
            const leaderRally = page.getByTestId('scheduling-leader-rally');
            await expect(leaderRally).toHaveAccessibleName(
                /^Rallied ✓ — You can do this again in 6h$/,
            );
            await expect(leaderRally).toBeDisabled();
        } finally {
            await apiDelete(token, `/lineups/${seeded.lineupId}`).catch(
                () => {},
            );
        }
    });

    test('Escape closes the menu and puts focus back on the ⋯ trigger', async ({
        page,
    }) => {
        const token = await getAdminToken();
        const seeded = await seedPollWithSlot(token, 11);
        try {
            await waitForSeededVote(token, seeded);
            await openPoll(page, seeded);
            const { isSheet } = await openLeaderMenu(page);

            // Escape is wired in both containers: `useMenuOpenState` handles it
            // for the popover, `BottomSheet` for the sheet — both close with
            // `restoreFocus: true`.
            await page.keyboard.press('Escape');
            await expect(
                page.getByTestId('scheduling-leader-rally'),
            ).toBeHidden({ timeout: 10_000 });
            await expect(menuTrigger(page)).toHaveAttribute(
                'aria-expanded',
                'false',
            );
            await expect(menuTrigger(page)).toBeFocused();

            if (!isSheet) return;
            // The sheet also carries an explicit close control; it must land
            // focus in the same place a keyboard dismiss does.
            await openLeaderMenu(page);
            await page
                .getByTestId('scheduling-leader-menu-sheet')
                .getByRole('button', { name: 'Close sheet' })
                .click();
            await expect(
                page.getByTestId('scheduling-leader-rally'),
            ).toBeHidden({ timeout: 10_000 });
            await expect(menuTrigger(page)).toBeFocused();
        } finally {
            await apiDelete(token, `/lineups/${seeded.lineupId}`).catch(
                () => {},
            );
        }
    });
});
