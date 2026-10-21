/**
 * ROK-1874 — the over-cap warning on the create form opened by "Lock this
 * time".
 *
 * Locking a slot opens `/events/new?gameId&startTime&matchId&lineupId`.
 * POST /events signs the creator up first and completing the poll then signs
 * up every yes-voter on that slot, so `rostered = 1 + yes-voters excluding
 * the creator`. When that exceeds `cap = min(slotPlayer, maxAttendees)` (over
 * whichever is set) the form shows the `scheduling-overflow-notice` status
 * banner; it goes away, live, as soon as the cap covers everyone.
 *
 * Seed (every test owns its poll, deleted in `finally`): a standalone poll
 * created by the admin (the creator), one proposed time — suggesting
 * auto-votes the admin YES — plus two fixture members voting YES ⇒
 * rostered 3. Cases:
 *
 *   1. Players = 2, no Max Attendees ⇒ banner with the spec's exact copy
 *      (3 people / 2 spots / 1 benched) and both voters' names, creator
 *      omitted; Increase Players ⇒ gone (at cap 3); Decrease ⇒ back (AC3).
 *   2. Max Attendees is the cap: Players 5 + Max 2 ⇒ banner; Max 3 ⇒ gone.
 *
 * The create form is never submitted — nothing here should create an event.
 * Runs in every viewport project (desktop / mobile / tablet); the banner sits
 * under the roster section, and `toBeVisible` scrolls nothing, so each
 * assertion is on presence + copy rather than on fold position.
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, getAdminToken } from './api-helpers';
import {
    getFirstGameId,
    seedFixtureVoter,
    seedPollWithSlot,
    voteAs,
    waitForPollVisible,
    waitForSlotCounts,
    type SeededPoll,
} from './scheduling-poll-fixtures';

/**
 * Fixture members (slots 4 + 5). Votes are per poll, so a sibling spec (or
 * the other viewport project) reusing the same users cannot move THIS poll's
 * numbers — every test seeds its own poll.
 */
const VOTER_SLOTS = [4, 5] as const;

const HEADING = 'More yes-votes than roster spots';
const FOOTER =
    'Who goes to the bench depends on signup order. Raise the player count, or ask voters to change their vote before you create the event.';

interface Seeded extends SeededPoll {
    gameId: number;
    /** The fixture voters' display names, as the poll API reports them. */
    voterNames: string[];
}

interface PollSlotVotes {
    slots?: {
        id: number;
        votes?: { userId: number; displayName: string }[];
    }[];
}

/** Delete the seeded poll's lineup; never let cleanup fail a test. */
async function cleanup(token: string, seeded: SeededPoll | null): Promise<void> {
    if (!seeded) return;
    await apiDelete(token, `/lineups/${seeded.lineupId}`).catch(() => {});
}

/** A poll whose one slot carries the admin + two fixture members' YES. */
async function seedOverCapPoll(token: string, daysOut: number): Promise<Seeded> {
    const gameId = await getFirstGameId(token);
    const seeded = await seedPollWithSlot(token, daysOut);
    const voterIds: number[] = [];
    for (const slot of VOTER_SLOTS) {
        const voter = await seedFixtureVoter(token, slot);
        await voteAs(voter.jwt, seeded, seeded.slotId);
        voterIds.push(voter.userId);
    }
    // Barrier: the form re-reads the poll, so the server must already hold
    // all three YES votes before the page opens.
    await waitForSlotCounts(token, seeded, seeded.slotId, { yes: 3, no: 0 });
    await waitForPollVisible(token, seeded);
    const poll = (await apiGet(
        token,
        `/lineups/${seeded.lineupId}/schedule/${seeded.pollId}`,
    )) as PollSlotVotes | null;
    const votes = poll?.slots?.find((s) => s.id === seeded.slotId)?.votes ?? [];
    const voterNames = votes
        .filter((v) => voterIds.includes(v.userId))
        .map((v) => v.displayName);
    expect(voterNames, 'both fixture voters on the slot').toHaveLength(2);
    return { ...seeded, gameId, voterNames };
}

/** Open the create form exactly as "Lock this time" does. */
async function openLockForm(page: Page, seeded: Seeded): Promise<void> {
    const params = new URLSearchParams({
        gameId: String(seeded.gameId),
        startTime: seeded.time.toISOString(),
        matchId: String(seeded.pollId),
        lineupId: String(seeded.lineupId),
    });
    await page.goto(`/events/new?${params.toString()}`);
    await expect(
        page.getByRole('heading', { name: 'Create Event', level: 1 }),
    ).toBeVisible({ timeout: 15_000 });
    // The banner only exists for a generic roster — pin it, whatever the
    // game's own default slot type is.
    const generic = page.getByRole('radio', { name: 'Generic Slots', exact: true });
    if (!(await generic.isChecked())) {
        await generic.locator('xpath=..').click();
    }
    await expect(generic).toBeChecked();
}

function notice(page: Page): Locator {
    return page.getByTestId('scheduling-overflow-notice');
}

function playersInput(page: Page): Locator {
    return page.getByRole('spinbutton', { name: 'Players slots', exact: true });
}

function maxAttendeesInput(page: Page): Locator {
    return page.getByLabel('Max Attendees', { exact: true });
}

/** Set both cap fields; an empty `max` means unlimited. */
async function setCaps(page: Page, players: number, max: string): Promise<void> {
    await maxAttendeesInput(page).fill(max);
    await expect(maxAttendeesInput(page)).toHaveValue(max);
    await playersInput(page).fill(String(players));
    await expect(playersInput(page)).toHaveValue(String(players));
}

/** The banner, with the spec's exact copy for 3 rostered on a `cap` roster. */
async function expectBanner(page: Page, seeded: Seeded, cap: number): Promise<void> {
    const banner = notice(page);
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner).toHaveAttribute('role', 'status');
    await expect(banner.getByText(HEADING, { exact: true })).toBeVisible();
    const benched = 3 - cap;
    const spots = cap === 1 ? 'spot' : 'spots';
    await expect(
        banner.getByText(
            `3 people will be signed up for this time, but the roster has ${cap} ${spots} — ${benched} will go to the bench.`,
            { exact: true },
        ),
    ).toBeVisible();
    // The admin voted (the suggester's auto-YES), so no "includes you" line.
    await expect(banner.getByText(/That count includes you/)).toHaveCount(0);
    const voters = banner.getByTestId('scheduling-overflow-voters');
    await expect(voters).toBeVisible();
    for (const name of seeded.voterNames) {
        await expect(voters).toContainText(name);
    }
    await expect(voters).toHaveText(/^Voted yes: /);
    await expect(banner.getByText(FOOTER, { exact: true })).toBeVisible();
}

test.describe('Scheduling lock — over-cap warning (ROK-1874)', () => {
    test.describe.configure({ timeout: 120_000 });

    test('Players under the yes-vote count warns; raising it to the count clears it', async ({
        page,
    }) => {
        const token = await getAdminToken();
        let seeded: Seeded | null = null;
        try {
            seeded = await seedOverCapPoll(token, 13);
            await openLockForm(page, seeded);

            await setCaps(page, 2, '');
            await expectBanner(page, seeded, 2);

            // At cap: 3 rostered on 3 spots — nobody benched, no banner.
            await page.getByRole('button', { name: 'Increase Players', exact: true }).click();
            await expect(playersInput(page)).toHaveValue('3');
            await expect(notice(page)).toHaveCount(0);

            // Lowering it again brings the banner back without a refetch.
            await page.getByRole('button', { name: 'Decrease Players', exact: true }).click();
            await expect(playersInput(page)).toHaveValue('2');
            await expectBanner(page, seeded, 2);
        } finally {
            await cleanup(token, seeded);
        }
    });

    test('Max Attendees is the cap when it is the smaller one', async ({ page }) => {
        const token = await getAdminToken();
        let seeded: Seeded | null = null;
        try {
            seeded = await seedOverCapPoll(token, 14);
            await openLockForm(page, seeded);

            await setCaps(page, 5, '2');
            await expectBanner(page, seeded, 2);

            await maxAttendeesInput(page).fill('3');
            await expect(maxAttendeesInput(page)).toHaveValue('3');
            await expect(notice(page)).toHaveCount(0);
        } finally {
            await cleanup(token, seeded);
        }
    });
});
