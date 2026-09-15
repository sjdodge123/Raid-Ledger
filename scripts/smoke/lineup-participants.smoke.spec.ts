/**
 * ROK-1346 — Lineup participants button + roster modal (Cycle 4 follow-up).
 *
 * TDD gate (TDD_WRITE_FAILING): these assertions describe the POST-feature
 * page and therefore FAIL against the current worktree, where neither the
 * hero `Participants · N` button nor the roster modal exist yet. The dev
 * agent (Step 2e) adds `LineupParticipantsButton` + `LineupParticipantsModal`,
 * the `action` slot on JourneyHero, and the `GET /lineups/:id/participants`
 * endpoint that powers them, so these pass.
 *
 * NEW testids the dev MUST wire to the SAME ids (documented in the TDD
 * report):
 *   - `lineup-participants-button`  → the hero `Participants · N` button
 *   - `lineup-participants-modal`   → the open modal container
 *   - `lineup-participant-row`      → one row per participant in the modal
 *
 * Phase coverage mirrors lineup-chrome-strip.smoke.spec.ts: the lineup state
 * machine terminates at `decided` (LineupStatusSchema = building | voting |
 * decided | archived — there is NO `scheduling` status). AC's "Scheduling"
 * phase is represented on the decided detail page by the JourneyHero ribbon's
 * Schedule step, so the button must render on `building` (Nominating),
 * `voting` (Voting), and `decided` (Decided + Scheduling-step) detail pages
 * plus the archived/aborted fallback header.
 *
 * Runs under BOTH Playwright projects (desktop + mobile); playwright.config.ts
 * handles project fan-out.
 */
import { test, expect } from './base';
import { dismissGameTimeCheck } from './helpers';
import type { Page } from '@playwright/test';
import {
    getAdminToken,
    apiGet,
    apiPatch,
    apiPost,
    apiPut,
    createLineupOrRetry,
    awaitProcessing,
    pollForCondition,
} from './api-helpers';

const FILE_PREFIX = 'lineup-participants';
let workerPrefix: string;
let lineupTitle: string;
let adminToken: string;

// Multi-call phase setup can exceed Playwright's default 30s hook timeout
// under full-suite mobile load.
const HOOK_TIMEOUT_MS = 90_000;

async function fetchGameIds(token: string, count: number): Promise<number[]> {
    const data = await apiGet(token, '/admin/settings/games');
    if (!data?.data?.length) {
        throw new Error('No games in DB — seed data missing');
    }
    return data.data.slice(0, count).map((g: { id: number }) => g.id);
}

/** Archive this worker's lineups (prefix-scoped, DEMO_MODE-only). */
async function resetWorkerLineups(token: string): Promise<void> {
    await apiPost(token, '/admin/test/reset-lineups', {
        titlePrefix: workerPrefix,
    });
}

/**
 * Create a fresh `building` lineup for this worker and walk it to
 * `targetPhase`. Nominations are seeded for any phase past building so
 * voting/decided have data + a winner candidate. Returns the id.
 */
async function setupLineupInPhase(
    token: string,
    targetPhase: 'building' | 'voting' | 'decided',
): Promise<number> {
    await resetWorkerLineups(token);
    const { id } = await createLineupOrRetry(
        token,
        {
            title: lineupTitle,
            visibility: 'public',
            buildingDurationHours: 720,
            votingDurationHours: 720,
            decidedDurationHours: 720,
            matchThreshold: 10,
        },
        workerPrefix,
    );

    if (targetPhase !== 'building') {
        const gameIds = await fetchGameIds(token, 3);
        for (const gid of gameIds) {
            await apiPost(token, `/lineups/${id}/nominate`, { gameId: gid });
        }
    }

    const walk: Record<string, string[]> = {
        building: [],
        voting: ['voting'],
        decided: ['voting', 'decided'],
    };
    for (const status of walk[targetPhase]) {
        const body: Record<string, unknown> = { status };
        if (status === 'decided') {
            const detail = await apiGet(token, `/lineups/${id}`);
            if (detail?.entries?.length > 0) {
                body.decidedGameId = detail.entries[0].gameId;
            }
        }
        await apiPatch(token, `/lineups/${id}/status`, body);
    }
    await awaitProcessing(token);
    return id;
}

/** Create an aborted (archived) public lineup so the fallback header renders. */
async function setupAbortedLineup(token: string): Promise<number> {
    await resetWorkerLineups(token);
    const { id } = await createLineupOrRetry(
        token,
        {
            title: lineupTitle,
            visibility: 'public',
            buildingDurationHours: 720,
            votingDurationHours: 720,
            decidedDurationHours: 720,
        },
        workerPrefix,
    );
    await apiPost(token, `/lineups/${id}/abort`, { reason: 'smoke abort' });
    await awaitProcessing(token);
    return id;
}

/** Assert the page mounted (no error boundary, hero ribbon present). */
async function expectPageMounted(page: Page): Promise<void> {
    await expect(page.locator('body')).not.toHaveText(/something went wrong/i, {
        timeout: 10_000,
    });
    await expect(
        page.getByRole('list', { name: 'Lineup progress' }).first(),
    ).toBeVisible({ timeout: 15_000 });
}

test.beforeAll(async ({}, testInfo) => {
    test.setTimeout(HOOK_TIMEOUT_MS);
    workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
    lineupTitle = `${workerPrefix}Smoke Lineup`;
    adminToken = await getAdminToken();
});

// ---------------------------------------------------------------------------
// AC 1/8 — Participants button present in hero across all detail-page phases
// ---------------------------------------------------------------------------

test.describe('Participants button — present across phases', () => {
    for (const phase of ['building', 'voting', 'decided'] as const) {
        test(`${phase}: hero shows a "Participants · N" button with avatar stack`, async ({
            page,
        }) => {
            test.setTimeout(HOOK_TIMEOUT_MS);
            const lineupId = await setupLineupInPhase(adminToken, phase);

            await page.goto(`/community-lineup/${lineupId}`);
            await expectPageMounted(page);

            const button = page.getByTestId('lineup-participants-button');
            await expect(button).toBeVisible({ timeout: 15_000 });
            // Label carries the count: "Participants · N" (the creator always
            // counts, so N >= 1).
            await expect(button).toContainText(/Participants\s*·\s*\d+/);
            // Accessible name includes "Participants" so screen readers
            // announce it.
            await expect(button).toHaveAccessibleName(/Participants/i);
        });
    }

    test('decided page: Participants button coexists with the Schedule ribbon step (AC8 Scheduling)', async ({
        page,
    }) => {
        test.setTimeout(HOOK_TIMEOUT_MS);
        // "Scheduling" has no dedicated lineup status — it is the ribbon's
        // Schedule step on the decided page. The button must render here too.
        const lineupId = await setupLineupInPhase(adminToken, 'decided');

        await page.goto(`/community-lineup/${lineupId}`);
        await expectPageMounted(page);

        const ribbon = page
            .getByRole('list', { name: 'Lineup progress' })
            .first();
        await expect(ribbon).toContainText(/Schedule/i, { timeout: 5_000 });
        await expect(
            page.getByTestId('lineup-participants-button'),
        ).toBeVisible({ timeout: 15_000 });
    });

    test('archived/aborted fallback header still shows the Participants button', async ({
        page,
    }) => {
        test.setTimeout(HOOK_TIMEOUT_MS);
        const lineupId = await setupAbortedLineup(adminToken);

        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        await expect(
            page.getByTestId('lineup-participants-button'),
        ).toBeVisible({ timeout: 15_000 });
    });
});

// ---------------------------------------------------------------------------
// AC 2/4/5 — Modal opens, lists participants, is accessible (public lineup)
// ---------------------------------------------------------------------------

test.describe('Participants modal — public lineup', () => {
    test('clicking the button opens an accessible modal listing participants', async ({
        page,
    }) => {
        test.setTimeout(HOOK_TIMEOUT_MS);
        // Public lineup in voting with seeded nominations → creator + at least
        // one participant in the roster.
        const lineupId = await setupLineupInPhase(adminToken, 'voting');

        await page.goto(`/community-lineup/${lineupId}`);
        await expectPageMounted(page);

        // Closed by default.
        await expect(
            page.getByTestId('lineup-participants-modal'),
        ).toHaveCount(0);

        const button = page.getByTestId('lineup-participants-button');
        await button.click();

        const modal = page.getByTestId('lineup-participants-modal');
        await expect(modal).toBeVisible({ timeout: 5_000 });

        // Accessible dialog with a "Participants" name.
        const dialog = page.getByRole('dialog', { name: /Participants/i });
        await expect(dialog).toBeVisible({ timeout: 5_000 });

        // At least one participant row (the creator always appears).
        await expect(
            modal.getByTestId('lineup-participant-row').first(),
        ).toBeVisible({ timeout: 5_000 });

        // Esc closes the modal (focus trap + dismiss from ui/modal.tsx).
        await page.keyboard.press('Escape');
        await expect(
            page.getByTestId('lineup-participants-modal'),
        ).toHaveCount(0);
    });

    test('modal focus is trapped inside the dialog while open', async ({
        page,
    }) => {
        test.setTimeout(HOOK_TIMEOUT_MS);
        const lineupId = await setupLineupInPhase(adminToken, 'voting');

        await page.goto(`/community-lineup/${lineupId}`);
        await expectPageMounted(page);

        await page.getByTestId('lineup-participants-button').click();
        const modal = page.getByTestId('lineup-participants-modal');
        await expect(modal).toBeVisible({ timeout: 5_000 });

        // Focus must live inside the DIALOG once it opens (focus trap). The
        // trap ref lives on the role=dialog container (ui/modal.tsx), which
        // also holds the header/close button — the inner testid div is only
        // the body wrapper, so containment must be asserted on the dialog.
        const dialog = page.getByRole('dialog', { name: /Participants/i });
        // Tab a few times and confirm the active element never escapes.
        for (let i = 0; i < 5; i++) {
            await page.keyboard.press('Tab');
            const focusInside = await dialog.evaluate((el) =>
                el.contains(document.activeElement),
            );
            expect(focusInside).toBe(true);
        }
    });
});

// ---------------------------------------------------------------------------
// AC 3 — Modal lists invitees + creator for a private lineup
// ---------------------------------------------------------------------------

test.describe('Participants modal — private lineup', () => {
    test('private lineup modal lists the creator + invitees', async ({
        page,
    }) => {
        test.setTimeout(HOOK_TIMEOUT_MS);
        await resetWorkerLineups(adminToken);

        // Private lineup needs at least one invitee. Use the admin itself as a
        // second-party invitee is not valid (creator auto-included); seed a
        // throwaway invitee via the test seed endpoint.
        const invitee = (await apiPost(
            adminToken,
            '/admin/test/seed-fixture-user',
            {},
        )) as { userId?: number } | null;
        const inviteeUserIds =
            invitee?.userId != null ? [invitee.userId] : [];

        const created = (await apiPost(adminToken, '/lineups', {
            title: lineupTitle,
            visibility: 'private',
            inviteeUserIds,
            buildingDurationHours: 720,
            votingDurationHours: 720,
            decidedDurationHours: 720,
        })) as { id?: number };
        expect(created?.id).toBeTruthy();
        const lineupId = created!.id as number;
        await awaitProcessing(adminToken);

        await page.goto(`/community-lineup/${lineupId}`);
        await expectPageMounted(page);

        await page.getByTestId('lineup-participants-button').click();
        const modal = page.getByTestId('lineup-participants-modal');
        await expect(modal).toBeVisible({ timeout: 5_000 });

        // Creator + invitee → at least 2 rows for a private lineup.
        const rows = modal.getByTestId('lineup-participant-row');
        await expect(rows.first()).toBeVisible({ timeout: 5_000 });
        expect(await rows.count()).toBeGreaterThanOrEqual(2);
    });
});

// ---------------------------------------------------------------------------
// ROK-1557 — on a scheduling poll the modal must answer the POLL, not the
// lineup phase: a member who has tapped Vote reads "Voted", not "Waiting".
//
// This describe OWNS its poll. Sibling describes in this file archive/advance
// their lineups, so reusing one of theirs would race the chip we assert on.
// The scheduling-poll fixtures (goToPoll, the game-time dismiss) are
// duplicated rather than imported — Playwright spec files do not share modules
// cleanly, and scheduling-poll.smoke.spec.ts exports none of them.
// ---------------------------------------------------------------------------

test.describe('Participants modal — scheduling poll (ROK-1557)', () => {
    let pollLineupId: number;
    let pollMatchId: number;
    let slotId: number;

    /**
     * Dismiss the GameTimeRefreshModal if it auto-opened. It self-gates on
     * stale game time, so on a fresh standalone poll it usually does not
     * appear — dismiss defensively so it can never sit over the toolbar.
     */
    async function dismissGameTimeModalIfPresent(p: Page): Promise<void> {
        // ROK-1569: the two shells no longer share a body testid (the phone's
        // step 1 is the week editor), so the probe lives in one place.
        await dismissGameTimeCheck(p);
    }

    /** Navigate to the poll page and wait for the composite to mount. */
    async function goToPoll(p: Page): Promise<void> {
        await p.goto(
            `/community-lineup/${pollLineupId}/schedule/${pollMatchId}`,
        );
        await dismissGameTimeModalIfPresent(p);
        await expect(
            p.locator('[data-testid="scheduling-composite"]'),
        ).toBeVisible({ timeout: 20_000 });
    }

    /** Open the Participants modal from the poll toolbar and return it. */
    async function openParticipants(p: Page) {
        const button = p.getByTestId('lineup-participants-button');
        await expect(button).toBeVisible({ timeout: 15_000 });
        await button.scrollIntoViewIfNeeded();
        await button.click();
        const modal = p.getByTestId('lineup-participants-modal');
        await expect(modal).toBeVisible({ timeout: 10_000 });
        await expect(
            p.getByRole('dialog', { name: /Participants/i }),
        ).toBeVisible({ timeout: 5_000 });
        return modal;
    }

    /** Normalised text of the row carrying the Creator role chip. */
    async function creatorRowText(modal: ReturnType<Page['locator']>) {
        const row = modal
            .getByTestId('lineup-participant-row')
            .filter({ hasText: /Creator/ })
            .first();
        await expect(row).toBeVisible({ timeout: 10_000 });
        return (await row.innerText()).replace(/\s+/g, ' ').trim();
    }

    /**
     * Pure read of the Creator row for `expect.poll` — no assertions inside
     * (a throw in a poll callback propagates instead of retrying), an empty
     * string while the row is not there yet.
     */
    async function creatorRowTextQuiet(
        modal: ReturnType<Page['locator']>,
    ): Promise<string> {
        const row = modal
            .getByTestId('lineup-participant-row')
            .filter({ hasText: /Creator/ })
            .first();
        const text = await row.innerText({ timeout: 2_000 }).catch(() => '');
        return text.replace(/\s+/g, ' ').trim();
    }

    test.beforeAll(async () => {
        test.setTimeout(HOOK_TIMEOUT_MS);
        const [gameId] = await fetchGameIds(adminToken, 1);

        // Freshen the admin's game time FIRST (confirmed_at = now). The poll
        // page's GameTimeRefreshModal is stale-gated and paints a fixed
        // inset-0 z-50 overlay over the toolbar; on a fresh env the admin's
        // game time is stale, the modal opened after the dismiss probe's
        // 1.5 s window, and every click on the Participants button was
        // intercepted (both projects, 2026-09-15 fleet run). Same idiom as
        // scheduling-poll.smoke.spec.ts's beforeAll.
        await apiPut(adminToken, '/users/me/game-time', {
            slots: [
                { dayOfWeek: 1, hour: 19 },
                { dayOfWeek: 1, hour: 20 },
                { dayOfWeek: 3, hour: 20 },
            ],
        });

        // A standalone poll is its own lineup + match, so nothing else in this
        // file (or any sibling worker) can archive it mid-test.
        const poll = (await apiPost(adminToken, '/scheduling-polls', {
            gameId,
            durationHours: 72,
        })) as { id?: number; lineupId?: number };
        if (!poll?.id || !poll?.lineupId) {
            throw new Error(
                `POST /scheduling-polls did not return {id, lineupId}: ${JSON.stringify(poll)}`,
            );
        }
        pollMatchId = poll.id;
        pollLineupId = poll.lineupId;

        const when = new Date(Date.now() + 3 * 86_400_000);
        when.setHours(20, 0, 0, 0);
        const suggested = (await apiPost(
            adminToken,
            `/lineups/${pollLineupId}/schedule/${pollMatchId}/suggest`,
            { proposedTime: when.toISOString() },
        )) as { id?: number; data?: { id?: number } };
        slotId = (suggested?.data?.id ?? suggested?.id) as number;
        if (!slotId) throw new Error('suggest did not return a slot id');

        // Suggesting auto-votes the suggester. Toggle those votes off so the
        // tap in the test is the only thing that can move the admin's chip.
        const before = await apiGet(
            adminToken,
            `/lineups/${pollLineupId}/schedule/${pollMatchId}`,
        );
        for (const voted of (before?.myVotedSlotIds ?? []) as number[]) {
            await apiPost(
                adminToken,
                `/lineups/${pollLineupId}/schedule/${pollMatchId}/vote`,
                { slotId: voted },
            );
        }

        // The page reads this endpoint with a 15s staleTime — make sure the
        // slot exists and the admin holds no votes before any navigation.
        await pollForCondition(
            async () => {
                const p = await apiGet(
                    adminToken,
                    `/lineups/${pollLineupId}/schedule/${pollMatchId}`,
                );
                if (!p?.slots?.length) return null;
                return (p.myVotedSlotIds?.length ?? 0) === 0 ? p : null;
            },
            {
                timeoutMs: 20_000,
                description:
                    'the standalone poll to expose its slot with no admin votes',
            },
        );
        await awaitProcessing(adminToken);
    });

    test('one tap on a slot flips the creator row from Waiting to Voted', async ({
        page,
    }) => {
        test.setTimeout(HOOK_TIMEOUT_MS);
        await goToPoll(page);

        // Baseline: nobody has voted on this fresh poll, so the creator reads
        // Waiting. (The pre-fix build also said Waiting here — this is the
        // control, not the regression guard.)
        const beforeModal = await openParticipants(page);
        const beforeText = await creatorRowText(beforeModal);
        expect(
            beforeText,
            `ROK-1557 baseline: on a poll with zero votes the creator row should read "Waiting" but read: "${beforeText}"`,
        ).toMatch(/Waiting/);

        await page.keyboard.press('Escape');
        await expect(
            page.getByTestId('lineup-participants-modal'),
        ).toHaveCount(0);

        // ONE tap — the same interaction a member makes on the poll.
        const row = page.locator(
            `[data-testid="schedule-slot"][data-slot-id="${slotId}"]`,
        );
        await expect(row).toBeVisible({ timeout: 15_000 });
        await Promise.all([
            page
                .waitForResponse(
                    (r) =>
                        r.url().includes('/vote') &&
                        r.request().method() === 'POST',
                )
                .catch(() => null),
            row.getByRole('button', { name: /vote/i }).first().click(),
        ]);
        await expect(row).toHaveAttribute('data-voted', 'true', {
            timeout: 15_000,
        });

        // AC2: reopening must show the creator as Voted — no page reload.
        // Pre-fix this read "Waiting" because the modal answered the LINEUP
        // phase (nomination/vote state) instead of the scheduling poll.
        const afterModal = await openParticipants(page);
        await expect
            .poll(() => creatorRowTextQuiet(afterModal), {
                timeout: 15_000,
                message:
                    'ROK-1557: after one tap the creator row must read the "Voted" chip. A "Waiting" chip here means the participants modal is still answering the lineup phase instead of the scheduling poll (matchId not reaching GET /lineups/:id/participants, or the vote mutation not invalidating PARTICIPANTS_KEY).',
            })
            .toMatch(/Voted/);

        // …and the role chip still reads Creator on that same row.
        const afterText = await creatorRowText(afterModal);
        expect(
            afterText,
            `ROK-1557: the voter's row must keep its "Creator" role chip but read: "${afterText}"`,
        ).toMatch(/Creator/i);
    });
});
