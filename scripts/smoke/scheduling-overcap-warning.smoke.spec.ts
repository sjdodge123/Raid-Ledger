/**
 * ROK-1874 — the over-cap warning on the create form opened by "Lock this
 * time".
 *
 * Locking a slot opens `/events/new?gameId&startTime&matchId&lineupId`.
 * POST /events signs the creator up first and completing the poll then signs
 * up every yes-voter on that slot, so `rostered = 1 + yes-voters excluding
 * the creator`. When that exceeds `cap` (Players when set, else Max
 * Attendees — the API's `resolveEventCapacity` order) the form shows the `scheduling-overflow-notice` status
 * banner; it goes away, live, as soon as the cap covers everyone.
 *
 * Seed (`scheduling-overcap-fixtures.ts`; every test owns its poll, deleted
 * in `finally`): the admin (creator) + two fixture members voting YES in a
 * known order ⇒ rostered 3. Cases:
 *
 *   1. Players = 2, no Max Attendees ⇒ banner with the spec's exact copy
 *      (3 people / 2 spots / 1 benched) and both voters as bench-picker
 *      checkboxes, creator omitted, the latest voter marked (ROK-2025);
 *      Increase Players ⇒ gone (at cap 3); Decrease ⇒ back (AC3).
 *   2. Players overrides Max Attendees: Players 2 + Max 5 ⇒ banner (cap 2);
 *      Players 5 + Max 2 ⇒ gone (all 3 get player slots).
 *
 * The create form is never submitted — nothing here should create an event.
 * Runs in every viewport project (desktop / mobile / tablet); the banner sits
 * under the roster section, and `toBeVisible` scrolls nothing, so each
 * assertion is on presence + copy rather than on fold position.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './base';
import { getAdminToken } from './api-helpers';
import {
    benchPickBox,
    benchPicker,
    cleanupOverCapPoll as cleanup,
    openLockForm,
    overflowNotice as notice,
    playersInput,
    seedOverCapPoll,
    setCaps,
    type OverCapPoll as Seeded,
} from './scheduling-overcap-fixtures';

const HEADING = 'More yes-votes than roster spots';
/** ROK-2025: the footer now follows the bench picker. */
const FOOTER =
    'Or raise the player count, or ask voters to change their vote, before you create the event.';

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
    // ROK-2025: the voter list became the bench picker — every voter is a
    // checkbox row (creator omitted), the latest `benched` voters marked.
    const picker = benchPicker(page);
    await expect(picker).toBeVisible();
    const latest = seeded.voterIds.slice(-benched);
    for (const [i, id] of seeded.voterIds.entries()) {
        const name = seeded.voterNames[i] ?? '';
        await expect(picker.getByRole('checkbox', { name, exact: true })).toBeVisible();
        const box = benchPickBox(page, id);
        if (latest.includes(id)) await expect(box).toBeChecked();
        else await expect(box).not.toBeChecked();
    }
    await expect(picker.getByRole('checkbox')).toHaveCount(seeded.voterIds.length);
    await expect(picker.getByTestId('bench-pick-count')).toHaveText(
        `${benched} of ${benched} picked`,
    );
    await expect(picker.getByTestId('bench-pick-error')).toHaveCount(0);
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

    test('Players is the cap even when Max Attendees is smaller', async ({ page }) => {
        const token = await getAdminToken();
        let seeded: Seeded | null = null;
        try {
            seeded = await seedOverCapPoll(token, 14);
            await openLockForm(page, seeded);

            await setCaps(page, 2, '5');
            await expectBanner(page, seeded, 2);

            // Players 5 covers all 3; the smaller Max Attendees benches nobody.
            await setCaps(page, 5, '2');
            await expect(notice(page)).toHaveCount(0);
        } finally {
            await cleanup(token, seeded);
        }
    });
});
