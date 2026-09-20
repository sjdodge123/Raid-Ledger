/**
 * Shared seeding + selector helpers for the scheduling-poll stance specs
 * (ROK-1617).
 *
 * Extracted from `scheduling-anti-vote.smoke.spec.ts` when the leader FLOOR
 * landed: `leadsAtAll` (`packages/contract/src/scheduling-slot-order.ts`) only
 * calls a time "leading" when `voteCount - noCount > 0`, so most of these
 * cases now need a SECOND member's yes vote to keep a leader on the card while
 * the viewer says no. That seeding is identical in both spec files, and a
 * second copy of it is how two surfaces drift apart.
 *
 * Nothing here is a spec file (`testMatch: /\.smoke\.spec\.ts$/`), so
 * Playwright never collects it as tests.
 */
import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { API_BASE, apiGet, apiPost, pollForCondition } from './api-helpers';

/** Attempts for the racy fixture-user seed — see {@link seedFixtureVoter}. */
const SEED_ATTEMPTS = 3;

export interface SeededPoll {
    lineupId: number;
    pollId: number;
    slotId: number;
    /** The proposed time of `slotId`, for the label the page renders. */
    time: Date;
}

/** A poll seeded with two proposed times — see {@link seedPollWithTwoSlots}. */
export interface TwoSlotPoll extends SeededPoll {
    slotIdB: number;
    timeB: Date;
}

/** Get a valid gameId from seeded data (a poll needs a game). */
export async function getFirstGameId(token: string): Promise<number> {
    const res = await fetch(`${API_BASE}/games/configured`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Failed to fetch games: ${res.status}`);
    const body = (await res.json()) as { data: { id: number }[] };
    if (!body.data?.length) throw new Error('No configured games');
    return body.data[0].id;
}

/** Suggest one more time on an existing poll; returns the new slot's id. */
async function suggestSlot(
    token: string,
    lineupId: number,
    pollId: number,
    when: Date,
): Promise<number> {
    const suggested = (await apiPost(
        token,
        `/lineups/${lineupId}/schedule/${pollId}/suggest`,
        { proposedTime: when.toISOString() },
    )) as { id?: number; data?: { id?: number } } | null;
    const slotId = suggested?.data?.id ?? suggested?.id;
    expect(slotId).toBeTruthy();
    return slotId!;
}

/** `daysOut` days from now at 20:00 local. */
function futureTime(daysOut: number): Date {
    const when = new Date();
    when.setDate(when.getDate() + daysOut);
    when.setHours(20, 0, 0, 0);
    return when;
}

/**
 * Create a standalone poll with exactly one proposed time.
 *
 * Suggesting auto-votes the suggester YES, so the seeded row starts at
 * `data-voted="true"` — `resetToUnanswered` walks it back to the
 * not-answered baseline the anti-vote cases start from.
 */
export async function seedPollWithSlot(
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

    const when = futureTime(daysOut);
    const slotId = await suggestSlot(token, poll.lineupId, poll.id, when);
    return { lineupId: poll.lineupId, pollId: poll.id, slotId, time: when };
}

/**
 * A poll with TWO proposed times, so the leading card can actually move.
 *
 * ROK-1617 follow-up: every single-slot case is precisely why CI never caught
 * the stranded-guard bug — with one row the ladder never reorders and no press
 * on a SECOND slot can detach the first one's mutation observer. `slotId` is
 * the EARLIER time (it wins a net-score tie).
 */
export async function seedPollWithTwoSlots(
    token: string,
    daysOutA: number,
    daysOutB: number,
): Promise<TwoSlotPoll> {
    const first = await seedPollWithSlot(token, daysOutA);
    const when = futureTime(daysOutB);
    const slotIdB = await suggestSlot(
        token,
        first.lineupId,
        first.pollId,
        when,
    );
    return { ...first, slotIdB, timeB: when };
}

/**
 * A distinct non-admin member, by fixture SLOT
 * (`api/src/admin/demo-test-fixture-user.controller.ts`, slots 1..9 —
 * idempotent, keyed on a stable `discord_id`).
 *
 * Slot 1 is the shared `getInviteeToken()` persona half a dozen other specs
 * drive; these cases take slots 2+ so a sibling spec cannot move OUR poll's
 * numbers. Voting enrols the voter as a poll member on its own
 * (`scheduling-vote-membership.integration.spec.ts` — "open-roster"), so no
 * separate invite call is needed.
 *
 * The retry is NOT belt-and-braces: the endpoint is a SELECT-then-INSERT on
 * one `discord_id`, and the desktop/mobile/tablet projects are separate worker
 * processes started together against ONE API, so the first run for a given
 * slot races and the loser's INSERT answers 500 (documented verbatim in
 * `lfg-group-page.smoke.spec.ts::seedInvitee`). Retrying is a complete fix —
 * the second attempt takes the SELECT branch, because the winner's row is
 * committed by the time the loser fails. A 4xx is a real misconfiguration and
 * is NOT retried.
 */
export async function seedFixtureVoter(
    adminToken: string,
    slot: number,
): Promise<{ userId: number; jwt: string }> {
    let lastDiagnostic = '';
    for (let attempt = 1; attempt <= SEED_ATTEMPTS; attempt++) {
        const res = await fetch(`${API_BASE}/admin/test/seed-fixture-user`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${adminToken}`,
            },
            body: JSON.stringify({ slot }),
        });
        if (res.ok) {
            return (await res.json()) as { userId: number; jwt: string };
        }
        const body = await res.text().catch(() => '');
        lastDiagnostic = `${res.status} ${body.slice(0, 200)}`;
        // 4xx is a real misconfiguration (DEMO_MODE off, bad token) — retrying
        // it would only bury the message.
        if (res.status < 500) break;
    }
    throw new Error(
        `seed-fixture-user(slot ${slot}) failed after ${SEED_ATTEMPTS} attempts: ${lastDiagnostic}`,
    );
}

/** Cast `stance` as `voterToken` on `slotId` of the seeded poll. */
export async function voteAs(
    voterToken: string,
    seeded: SeededPoll,
    slotId: number,
    stance: 'yes' | 'no' = 'yes',
): Promise<void> {
    await apiPost(
        voterToken,
        `/lineups/${seeded.lineupId}/schedule/${seeded.pollId}/vote`,
        { slotId, stance },
    );
}

/** The poll payload, as far as these specs read it. */
interface PollPayload {
    match?: unknown;
    slots?: { id: number; votes?: unknown[]; noVotes?: unknown[] }[];
    myVotedSlotIds?: number[];
    myNoSlotIds?: number[];
}

/** Read the poll through the admin's eyes. */
async function readPoll(
    token: string,
    seeded: SeededPoll,
): Promise<PollPayload | null> {
    return (await apiGet(
        token,
        `/lineups/${seeded.lineupId}/schedule/${seeded.pollId}`,
    )) as PollPayload | null;
}

/**
 * The date half of the label a slot renders (`scheduling-slot-time.ts` →
 * `toLocaleString('en-US', …)`), e.g. `Thu, Sep 25`. The time half is left off
 * deliberately: Node and Chromium can disagree on the space before AM/PM
 * (U+202F on newer ICU), and that difference would fail a full-string match
 * for no behavioural reason.
 */
export function slotDateLabel(when: Date): string {
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
export async function waitForPollVisible(
    token: string,
    seeded: SeededPoll,
): Promise<void> {
    await pollForCondition(
        async () => {
            const data = await readPoll(token, seeded);
            return data?.match ? data : null;
        },
        {
            timeoutMs: 15_000,
            description: 'the seeded scheduling poll endpoint',
        },
    );
}

/**
 * Poll the API until `slotId` carries exactly `yes` votes and `no` anti-votes.
 *
 * The seeded fixture voters write through a SECOND session, so this is the
 * barrier between "we posted their vote" and "the page will render it" — a
 * navigation that beats the write reads a leader derived from the wrong
 * counts, which under the floor is the difference between a leader card and
 * the empty state.
 */
export async function waitForSlotCounts(
    token: string,
    seeded: SeededPoll,
    slotId: number,
    counts: { yes: number; no: number },
): Promise<void> {
    await pollForCondition(
        async () => {
            const data = await readPoll(token, seeded);
            const slot = data?.slots?.find((s) => s.id === slotId);
            if (!slot) return null;
            const yes = slot.votes?.length ?? 0;
            const no = slot.noVotes?.length ?? 0;
            return yes === counts.yes && no === counts.no ? { yes, no } : null;
        },
        {
            timeoutMs: 15_000,
            description: `slot ${slotId} to read ${counts.yes} yes / ${counts.no} no`,
        },
    );
}

/**
 * Poll the API until the viewer's own stances on the seeded poll satisfy
 * `predicate` — never `sleep`. The page is `useQuery`-backed with a staleTime,
 * so the server is the only honest witness that a press left the browser.
 */
export async function waitForStances(
    token: string,
    seeded: SeededPoll,
    predicate: (stances: { yes: number[]; no: number[] }) => boolean,
    description: string,
): Promise<void> {
    await pollForCondition(
        async () => {
            const data = await readPoll(token, seeded);
            const stances = {
                yes: data?.myVotedSlotIds ?? [],
                no: data?.myNoSlotIds ?? [],
            };
            return predicate(stances) ? stances : null;
        },
        { timeoutMs: 15_000, description },
    );
}

/** A slot's row by id. Exact `data-slot-id` — never a prefix match. */
export function slotRowById(page: Page, slotId: number): Locator {
    return page.locator(
        `[data-testid="schedule-slot"][data-slot-id="${slotId}"]`,
    );
}

/** The seeded slot's row. */
export function slotRow(page: Page, seeded: SeededPoll): Locator {
    return slotRowById(page, seeded.slotId);
}

/**
 * The YES control (`SchedulingSlotRow.tsx:218-234`). It has no test id; its
 * accessible name is "Vote for <time>" / "Remove vote for <time>", both of
 * which match — and neither of the NO control's two labels ("Mark … as not
 * working for you" / "… does not work for you — press to clear") does, so
 * this resolves to exactly one button in either stance.
 */
export function yesToggle(row: Locator): Locator {
    return row.getByRole('button', { name: /vote for /i });
}

/** The "Doesn't work" control (`SchedulingSlotRow.tsx:124-141`). */
export function noToggle(row: Locator): Locator {
    return row.getByTestId('slot-no-toggle');
}

/** Open the poll page; returns once the composite has rendered. */
export async function openPollPage(
    page: Page,
    seeded: SeededPoll,
): Promise<void> {
    await page.goto(
        `/community-lineup/${seeded.lineupId}/schedule/${seeded.pollId}`,
    );
    await expect(page.getByTestId('scheduling-composite')).toBeVisible({
        timeout: 15_000,
    });
}

/** Open the poll page and return the seeded slot's row, rendered. */
export async function openPoll(
    page: Page,
    seeded: SeededPoll,
): Promise<Locator> {
    await openPollPage(page, seeded);
    const row = slotRow(page, seeded);
    await expect(row).toBeVisible({ timeout: 15_000 });
    return row;
}

/**
 * Walk the suggester's auto-YES back to "not answered" — the third state the
 * anti-vote cases need as their baseline.
 */
export async function resetToUnanswered(row: Locator): Promise<void> {
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
