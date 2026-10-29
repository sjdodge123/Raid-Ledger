/**
 * ROK-2025 — on a scheduling lock-in the organizer picks who goes to the
 * bench.
 *
 * Seed (`scheduling-overcap-fixtures.ts`): the admin (creator) + fixture
 * members A then B voting YES on one slot ⇒ rostered 3. Players = 2 ⇒ one
 * voter is benched. The picker marks the LATEST voter (B) by default.
 *
 * The test: B is pre-marked and A is not; unmarking B shows the inline error
 * and blocks the submit (the guard scrolls the picker into view, nothing is
 * created); marking A instead and submitting sends `benchUserIds: [A]` on
 * the ONE claim-first `POST /scheduling-polls/:id/lock-in` (ROK-2032), which
 * answers 200 with `benchPickFallback: false` (the server honoured the pick,
 * it did not fall back to the default), and the event's roster has exactly A
 * on the bench — the pick beat the default.
 *
 * Runs in every viewport project. Each project gets its own day so two
 * projects' events never share an instant.
 */
import type { Page, Request, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import {
    apiDelete,
    apiGet,
    getAdminToken,
    pollForCondition,
} from './api-helpers';
import {
    benchPickBox,
    benchPicker,
    cleanupOverCapPoll,
    openLockForm,
    seedOverCapPoll,
    setCaps,
    type OverCapPoll,
} from './scheduling-overcap-fixtures';

const BASE_DAYS_OUT = 17;
const FALLBACK_TOAST_RE = /votes changed while you were choosing/;

interface RosterRow {
    userId?: number;
    slot?: string | null;
}

/** A distinct day per viewport project (desktop / mobile / tablet). */
function daysOutFor(testInfo: TestInfo): number {
    const idx = testInfo.config.projects.findIndex(
        (p) => p.name === testInfo.project.name,
    );
    return BASE_DAYS_OUT + Math.max(0, idx);
}

/** Every roster row of the event, assigned and unassigned. */
async function rosterRows(token: string, eventId: number): Promise<RosterRow[]> {
    const roster = (await apiGet(
        token,
        `/events/${eventId}/roster/assignments`,
    )) as { assignments?: RosterRow[]; pool?: RosterRow[] } | null;
    return [...(roster?.assignments ?? []), ...(roster?.pool ?? [])];
}

/**
 * Poll until both voters are on the roster (auto-signup is fire-and-forget
 * after the navigate), then return who sits on the bench.
 */
async function waitForBench(
    token: string,
    eventId: number,
    voterIds: number[],
): Promise<number[]> {
    let last: RosterRow[] = [];
    try {
        return await pollForCondition(
            async () => {
                last = await rosterRows(token, eventId);
                const ids = new Set(last.map((r) => r.userId));
                if (!voterIds.every((id) => ids.has(id))) return null;
                return last
                    .filter((r) => r.slot === 'bench')
                    .map((r) => r.userId)
                    .filter((id): id is number => typeof id === 'number');
            },
            { timeoutMs: 20_000, description: `voters on event ${eventId}'s roster` },
        );
    } catch {
        throw new Error(
            `Voters [${voterIds.join(', ')}] never all reached event ${eventId}'s roster; ` +
                `last read ${JSON.stringify(last)}`,
        );
    }
}

/** The create form's submit; the lock form has exactly one. */
function submitButton(page: Page) {
    return page.getByRole('button', { name: 'Create Event', exact: true });
}

/** The claim-first lock-in the form sends instead of POST /events (ROK-2032). */
function isLockIn(seeded: OverCapPoll) {
    return (r: Request) =>
        r.method() === 'POST' &&
        r.url().includes(`/scheduling-polls/${seeded.pollId}/lock-in`);
}

test.describe('Scheduling lock — the organizer picks who goes to the bench (ROK-2025)', () => {
    test.describe.configure({ timeout: 120_000 });

    test('latest voter pre-marked; a wrong count blocks submit; the pick lands on the bench', async ({
        page,
    }, testInfo) => {
        const token = await getAdminToken();
        let seeded: OverCapPoll | null = null;
        let eventId: number | undefined;
        try {
            seeded = await seedOverCapPoll(token, daysOutFor(testInfo));
            const [earlier, latest] = seeded.voterIds;
            if (earlier === undefined || latest === undefined) {
                throw new Error(`Expected two seeded voters, got ${JSON.stringify(seeded.voterIds)}`);
            }
            const poll = seeded;
            await openLockForm(page, poll);
            await setCaps(page, 2, '');

            // Default: the latest yes-voter is marked, the earlier one keeps a spot.
            const picker = benchPicker(page);
            await expect(picker).toBeVisible({ timeout: 15_000 });
            await expect(benchPickBox(page, latest)).toBeChecked();
            await expect(benchPickBox(page, earlier)).not.toBeChecked();
            await expect(picker.getByTestId('bench-pick-count')).toHaveText('1 of 1 picked');

            // Unmark the latest ⇒ 0 of 1: inline error, and submit is blocked.
            await benchPickBox(page, latest).click();
            await expect(benchPickBox(page, latest)).not.toBeChecked();
            await expect(picker.getByTestId('bench-pick-count')).toHaveText('0 of 1 picked');
            const error = picker.getByTestId('bench-pick-error');
            await expect(error).toHaveText('Pick 1 more for the bench.');
            await expect(error).toHaveAttribute('role', 'alert');

            await page.locator('#title').fill(`smoke-bench-pick-${poll.pollId}`);
            let posted = 0;
            page.on('request', (r) => {
                if (r.method() !== 'POST') return;
                const path = new URL(r.url()).pathname;
                if (path.endsWith('/events') || path.endsWith('/lock-in')) posted++;
            });
            await submitButton(page).click();
            // The guard's observable effects: the picker is scrolled into view,
            // the page stays on the form, and neither POST /events nor the
            // lock-in left the page.
            await expect(picker).toBeInViewport();
            await expect(page).toHaveURL(/\/events\/new\?/);
            await expect(error).toHaveText('Pick 1 more for the bench.');
            expect(posted, 'a blocked submit must not create the event').toBe(0);

            // Mark the earlier voter instead ⇒ 1 of 1, no error.
            await benchPickBox(page, earlier).click();
            await expect(benchPickBox(page, earlier)).toBeChecked();
            await expect(picker.getByTestId('bench-pick-count')).toHaveText('1 of 1 picked');
            await expect(error).toHaveCount(0);

            const lockInReq = page.waitForRequest(isLockIn(poll), { timeout: 30_000 });
            const lockInRes = page.waitForResponse((r) => isLockIn(poll)(r.request()), {
                timeout: 30_000,
            });
            await submitButton(page).click();
            const body = (await lockInReq).postDataJSON() as { benchUserIds?: number[] };
            expect(body.benchUserIds, 'the lock-in sends the organizer\'s pick').toEqual([earlier]);
            const res = await lockInRes;
            expect(res.status(), 'the claim-first lock-in succeeds').toBe(200);
            const result = (await res.json()) as { benchPickFallback?: boolean };
            expect(
                result.benchPickFallback,
                'the pick is honoured — true here means the server refused it and benched the default',
            ).toBe(false);

            await expect(page).toHaveURL(/\/events\/\d+(?:[?#].*)?$/, { timeout: 15_000 });
            eventId = Number(/\/events\/(\d+)/.exec(new URL(page.url()).pathname)?.[1]);
            expect(Number.isInteger(eventId) && eventId > 0, 'navigated to the created event').toBe(true);
            await expect(
                page.locator('[data-sonner-toast]').filter({ hasText: FALLBACK_TOAST_RE }),
                'no "votes changed" fallback toast',
            ).toHaveCount(0);

            const bench = await waitForBench(token, eventId, poll.voterIds);
            expect(bench, 'the bench is exactly the organizer\'s pick (the EARLIER voter), not the default').toEqual([earlier]);
        } finally {
            if (eventId) await apiDelete(token, `/events/${eventId}`).catch(() => null);
            await cleanupOverCapPoll(token, seeded);
        }
    });
});
