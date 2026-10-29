/**
 * ROK-2024 — locking in an OPEN scheduling poll of a community LINEUP match.
 *
 * The organiser's path: "⋯ Poll actions" on the leader card → "Lock this
 * time" → "Create anyway" (one YES voter is below the two-voter floor of
 * `computeRequiredVoters`) → the create form → "Create Event". The form
 * sends ONE claim-first `POST /scheduling-polls/:matchId/lock-in` (ROK-2032;
 * it used to be `POST /events` then `…/complete`) and navigates to the
 * created event. Before ROK-2024 the poll call 404'd for a lineup match (only
 * standalone polls were found): the form raised a warning toast and the poll
 * stayed open with no linked event.
 *
 * The fixture is a REAL community lineup (nominate → voting → vote →
 * decided), not `POST /scheduling-polls` (a standalone poll, which always
 * worked). Lineups are scoped to a per-worker title prefix so
 * `/admin/test/reset-lineups` never touches a sibling worker's rows.
 *
 * Requires DEMO_MODE=true (admin creates the lineup, hence organises it).
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './base';
import { dismissGameTimeCheck } from './helpers';
import {
    apiDelete,
    apiGet,
    apiPatch,
    apiPost,
    getAdminToken,
    pollForCondition,
} from './api-helpers';

const FILE_PREFIX = 'open-lockin';

interface LineupPoll {
    lineupId: number;
    matchId: number;
    slotId: number;
}

interface PollState {
    match?: { status?: string; linkedEventId?: number | null };
    slots?: { id: number; votes?: unknown[] }[];
}

async function firstGameId(token: string): Promise<number> {
    const body = (await apiGet(token, '/games/configured')) as {
        data?: { id: number }[];
    } | null;
    const id = body?.data?.[0]?.id;
    if (!id) throw new Error('No configured games to nominate');
    return id;
}

/**
 * A decided community lineup whose one game's match is in `scheduling`, with
 * one suggested slot ten days out (suggesting auto-votes the admin YES).
 */
async function seedLineupPoll(
    token: string,
    workerPrefix: string,
): Promise<LineupPoll> {
    await apiPost(token, '/admin/test/reset-lineups', {
        titlePrefix: workerPrefix,
        phases: ['building', 'voting', 'decided'],
    });
    const gameId = await firstGameId(token);
    const lineup = (await apiPost(token, '/lineups', {
        title: `${workerPrefix}Open Lock-in ${Date.now()}`,
        buildingDurationHours: 24,
        votingDurationHours: 48,
        decidedDurationHours: 24,
        matchThreshold: 10,
    })) as { id?: number } | null;
    const lineupId = lineup?.id;
    if (!lineupId) throw new Error('Failed to create the lineup');
    await apiPost(token, `/lineups/${lineupId}/nominate`, { gameId });
    await apiPatch(token, `/lineups/${lineupId}/status`, { status: 'voting' });
    await apiPost(token, `/lineups/${lineupId}/vote`, { gameId });
    await apiPatch(token, `/lineups/${lineupId}/status`, {
        status: 'decided',
        decidedGameId: gameId,
    });
    const matches = (await apiGet(token, `/lineups/${lineupId}/matches`)) as {
        scheduling?: { id: number }[];
    } | null;
    const matchId = matches?.scheduling?.[0]?.id;
    if (!matchId) throw new Error(`No scheduling match for lineup ${lineupId}`);
    const start = new Date(Date.now() + 10 * 86_400_000);
    start.setHours(20, 0, 0, 0);
    const slot = (await apiPost(
        token,
        `/lineups/${lineupId}/schedule/${matchId}/suggest`,
        { proposedTime: start.toISOString() },
    )) as { id?: number } | null;
    if (!slot?.id) throw new Error('Failed to suggest a slot');
    const slotId = slot.id;
    // The page caches its poll query — wait until the API serves the voted
    // slot so the leader card is drawn from the seeded numbers.
    await pollForCondition(
        async () => {
            const poll = (await apiGet(
                token,
                `/lineups/${lineupId}/schedule/${matchId}`,
            )) as PollState | null;
            const seeded = poll?.slots?.find((s) => s.id === slotId);
            return seeded && (seeded.votes?.length ?? 0) > 0 ? poll : null;
        },
        { timeoutMs: 20_000, description: 'the suggested slot to carry its auto-vote' },
    );
    return { lineupId, matchId, slotId };
}

/** The lock-in confirm: the modal dialog that carries a "Cancel" button. */
function lockConfirmDialog(page: Page): Locator {
    return page
        .getByRole('dialog')
        .filter({ has: page.getByRole('button', { name: 'Cancel', exact: true }) });
}

/** Open the leader card's ⋯ menu; return whichever container rendered. */
async function openLeaderMenu(page: Page): Promise<Locator> {
    const trigger = page
        .getByTestId('scheduling-leader-card')
        .getByTestId('scheduling-leader-menu');
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    await expect(trigger).toHaveAccessibleName('Poll actions');
    await trigger.click();
    const sheet = page.getByTestId('scheduling-leader-menu-sheet');
    const popover = page.getByTestId('scheduling-leader-menu-popover');
    await expect(sheet.or(popover)).toBeVisible({ timeout: 10_000 });
    return (await sheet.isVisible()) ? sheet : popover;
}

/** "Lock this time" → "Create anyway", landing on the prefilled create form. */
async function lockLeaderSlot(page: Page, seeded: LineupPoll): Promise<void> {
    const menu = await openLeaderMenu(page);
    await menu.getByTestId('scheduling-leader-lock').click();
    const confirm = lockConfirmDialog(page);
    await expect(confirm).toBeVisible({ timeout: 10_000 });
    await confirm.getByRole('button', { name: 'Create anyway', exact: true }).click();
    await expect(page).toHaveURL(
        new RegExp(`/events/new\\?.*matchId=${seeded.matchId}(&|$)`),
        { timeout: 15_000 },
    );
    await expect(
        page.getByRole('heading', { name: 'Create Event', level: 1 }),
    ).toBeVisible({ timeout: 15_000 });
}

/** Wait for the API to agree the match is scheduled on `eventId`. */
async function waitForScheduled(
    token: string,
    seeded: LineupPoll,
    eventId: number,
): Promise<void> {
    await pollForCondition(
        async () => {
            const poll = (await apiGet(
                token,
                `/lineups/${seeded.lineupId}/schedule/${seeded.matchId}`,
            )) as PollState | null;
            const m = poll?.match;
            return m?.status === 'scheduled' && m.linkedEventId === eventId
                ? poll
                : null;
        },
        {
            timeoutMs: 20_000,
            description: `match ${seeded.matchId} scheduled + linked to event ${eventId}`,
        },
    );
}

test.describe('Lineup poll — open lock-in creates the event and closes the poll (ROK-2024)', () => {
    test.describe.configure({ timeout: 120_000 });

    test('Poll actions → Lock this time → Create anyway → Create Event schedules the lineup match', async ({
        page,
    }, testInfo) => {
        const token = await getAdminToken();
        const workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
        const seeded = await seedLineupPoll(token, workerPrefix);
        let eventId: number | undefined;
        try {
            await page.goto(
                `/community-lineup/${seeded.lineupId}/schedule/${seeded.matchId}`,
            );
            await dismissGameTimeCheck(page);
            await expect(page.getByTestId('scheduling-composite')).toBeVisible({
                timeout: 15_000,
            });
            await lockLeaderSlot(page, seeded);

            await page.locator('#title').fill(`${workerPrefix}Open Lock-in Night`);
            const lockedIn = page.waitForResponse(
                (r) =>
                    r.request().method() === 'POST' &&
                    r.url().includes(`/scheduling-polls/${seeded.matchId}/lock-in`),
                { timeout: 30_000 },
            );
            await page.getByRole('button', { name: 'Create Event', exact: true }).click();

            const response = await lockedIn;
            expect(
                response.status(),
                'ROK-2024/2032: locking in a LINEUP match poll must succeed — a 404 here is the original bug (only standalone polls were found).',
            ).toBe(200);
            const result = (await response.json()) as { event?: { id?: number } };

            await expect(page).toHaveURL(/\/events\/\d+(?:[?#].*)?$/, { timeout: 15_000 });
            const idMatch = /\/events\/(\d+)/.exec(new URL(page.url()).pathname);
            eventId = Number(idMatch?.[1]);
            expect(Number.isInteger(eventId) && eventId > 0, 'navigated to the created event').toBe(true);
            expect(eventId, 'navigated to the event the lock-in created').toBe(result.event?.id);

            await expect(
                page.locator('[data-sonner-toast]').filter({ hasText: 'Event created successfully!' }),
            ).toBeVisible({ timeout: 10_000 });
            await expect(
                page.locator('[data-sonner-toast][data-type="error"], [data-sonner-toast][data-type="warning"]'),
                'ROK-2024/2032: no error or warning toast (a lost race, a bench fallback or a failed lock-in)',
            ).toHaveCount(0);

            await waitForScheduled(token, seeded, eventId);
            await page.goto(
                `/community-lineup/${seeded.lineupId}/schedule/${seeded.matchId}`,
            );
            const banner = page.getByTestId('read-only-banner');
            await expect(banner).toBeVisible({ timeout: 15_000 });
            await expect(banner).toHaveAttribute('data-poll-status', 'locked_in');
            await expect(banner.getByTestId('terminal-event-link')).toHaveAttribute(
                'href',
                `/events/${eventId}`,
            );
        } finally {
            if (eventId) {
                await apiDelete(token, `/events/${eventId}`).catch(() => null);
            }
            await apiPatch(token, `/lineups/${seeded.lineupId}/status`, {
                status: 'archived',
            }).catch(() => null);
        }
    });
});
