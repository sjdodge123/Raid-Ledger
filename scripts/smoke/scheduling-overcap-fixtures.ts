/**
 * Shared seeding + selectors for the over-cap lock-in specs:
 * `scheduling-overcap-warning.smoke.spec.ts` (ROK-1874, the banner) and
 * `scheduling-bench-picker.smoke.spec.ts` (ROK-2025, who goes to the bench).
 *
 * Extracted from the ROK-1874 spec so the bench-picker spec reuses the same
 * seed instead of importing a spec file (Playwright would register its tests
 * twice). Nothing here is a spec file (`testMatch: /\.smoke\.spec\.ts$/`).
 *
 * Seed: a standalone poll created by the admin (the creator), one proposed
 * time — suggesting auto-votes the admin YES — then two fixture members
 * voting YES in a known order (slot 4 first, slot 5 second) ⇒ rostered 3.
 */
import type { Locator, Page } from '@playwright/test';
import { expect } from './base';
import { apiDelete, apiGet } from './api-helpers';
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
 * Fixture members (slots 4 + 5), in the order they vote. Votes are per poll,
 * so a sibling spec (or another viewport project) reusing the same users
 * cannot move THIS poll's numbers — every test seeds its own poll.
 */
const VOTER_SLOTS = [4, 5] as const;

export interface OverCapPoll extends SeededPoll {
    gameId: number;
    /** The fixture voters' ids, in the order they voted (earliest first). */
    voterIds: number[];
    /** Their display names, same order as `voterIds`. */
    voterNames: string[];
}

interface PollSlotVotes {
    slots?: {
        id: number;
        votes?: { userId: number; displayName: string }[];
    }[];
}

/** Delete the seeded poll's lineup; never let cleanup fail a test. */
export async function cleanupOverCapPoll(
    token: string,
    seeded: SeededPoll | null,
): Promise<void> {
    if (!seeded) return;
    await apiDelete(token, `/lineups/${seeded.lineupId}`).catch(() => {});
}

/** The slot's votes as the poll API returns them (ROK-2025: vote order). */
async function readSlotVotes(
    token: string,
    seeded: SeededPoll,
): Promise<{ userId: number; displayName: string }[]> {
    const poll = (await apiGet(
        token,
        `/lineups/${seeded.lineupId}/schedule/${seeded.pollId}`,
    )) as PollSlotVotes | null;
    return poll?.slots?.find((s) => s.id === seeded.slotId)?.votes ?? [];
}

/** A poll whose one slot carries the admin + two fixture members' YES. */
export async function seedOverCapPoll(
    token: string,
    daysOut: number,
): Promise<OverCapPoll> {
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
    const votes = (await readSlotVotes(token, seeded)).filter((v) =>
        voterIds.includes(v.userId),
    );
    // ROK-2025: the poll returns votes in the order people said yes, which
    // is what makes "the latest are marked" deterministic.
    expect(
        votes.map((v) => v.userId),
        'the poll lists the fixture voters in the order they voted',
    ).toEqual(voterIds);
    return { ...seeded, gameId, voterIds, voterNames: votes.map((v) => v.displayName) };
}

/** Open the create form exactly as "Lock this time" does. */
export async function openLockForm(page: Page, seeded: OverCapPoll): Promise<void> {
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

export function overflowNotice(page: Page): Locator {
    return page.getByTestId('scheduling-overflow-notice');
}

export function benchPicker(page: Page): Locator {
    return overflowNotice(page).getByTestId('scheduling-bench-picker');
}

/** The bench checkbox for one voter (the testid sits on the native input). */
export function benchPickBox(page: Page, userId: number): Locator {
    return benchPicker(page).getByTestId(`bench-pick-${userId}`);
}

export function playersInput(page: Page): Locator {
    return page.getByRole('spinbutton', { name: 'Players slots', exact: true });
}

function maxAttendeesInput(page: Page): Locator {
    return page.getByLabel('Max Attendees', { exact: true });
}

/** Set both cap fields; an empty `max` means unlimited. */
export async function setCaps(page: Page, players: number, max: string): Promise<void> {
    await maxAttendeesInput(page).fill(max);
    await expect(maxAttendeesInput(page)).toHaveValue(max);
    await playersInput(page).fill(String(players));
    await expect(playersInput(page)).toHaveValue(String(players));
}
