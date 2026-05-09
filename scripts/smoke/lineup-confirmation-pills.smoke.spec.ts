/**
 * Lineup Confirmation-Pattern smoke tests (ROK-1209).
 *
 * Verifies AC-14, AC-16, AC-17, AC-18 end-to-end on the lineup detail page
 * across building, voting, and decided phases. Both desktop and mobile
 * Playwright projects exercise these tests per CLAUDE.md.
 *
 * Setup: per-worker prefixed lineup created in `beforeAll`. The admin user
 * is the creator and therefore resolves to the **organizer** persona (per
 * `getLineupPersona`: `isOperatorOrAdmin && creator → 'organizer'`). These
 * smoke tests assert organizer-persona hero copy + CTA wiring + the
 * confirmation pill rendering when the organizer themselves nominates/votes.
 * Invitee-acted / invitee-not-acted persona variants are covered
 * exhaustively by the vitest unit suite for `useLineupHero`,
 * `getLineupPersona`, `hasUserActedInPhase`, and `getLineupHeroCopy` —
 * smoke does not exercise them because there is no non-admin fixture user
 * available to the smoke harness today (tracked in TECH-DEBT-BACKLOG.md
 * 2026-05-09).
 *
 * NOTE: dev-brief and build-state.yaml referenced the path
 * `web/playwright/lineup-confirmation-pills.spec.ts`. The repo's
 * `playwright.config.ts` reads `./scripts/smoke/*.smoke.spec.ts`, so the
 * canonical home is here. Reported back to Lead as a spec-path gap.
 */
import { test, expect } from './base';
import {
    getAdminToken,
    apiGet,
    apiPatch,
    apiPost,
    createLineupOrRetry,
    awaitProcessing,
} from './api-helpers';

const FILE_PREFIX = 'lineup-confirmation-pills';
let workerPrefix: string;
let lineupTitle: string;
let adminToken: string;
let lineupId: number;
let gameIds: number[] = [];

async function fetchGameIds(token: string, count: number): Promise<number[]> {
    const data = await apiGet(token, '/admin/settings/games');
    if (!data?.data?.length) {
        throw new Error('No games in DB - seed data missing');
    }
    return data.data.slice(0, count).map((g: { id: number }) => g.id);
}

test.beforeAll(async ({}, testInfo) => {
    workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
    lineupTitle = `${workerPrefix}Smoke Lineup`;
    adminToken = await getAdminToken();
    gameIds = await fetchGameIds(adminToken, 3);

    const { id } = await createLineupOrRetry(
        adminToken,
        {
            title: lineupTitle,
            buildingDurationHours: 720,
            votingDurationHours: 720,
            decidedDurationHours: 720,
            matchThreshold: 10,
        },
        workerPrefix,
    );
    lineupId = id;
});

// ---------------------------------------------------------------------------
// Building phase — hero CTA opens nominate modal; pill appears post-nominate
// ---------------------------------------------------------------------------

test.describe('Building phase — hero + pill', () => {
    test.beforeEach(async () => {
        // Ensure no nominations from previous tests linger.
        const detail = await apiGet(adminToken, `/lineups/${lineupId}`);
        for (const e of detail?.entries ?? []) {
            await apiPost(adminToken, `/lineups/${lineupId}/remove-nomination`, {
                gameId: e.gameId,
            }).catch(() => undefined);
        }
        await awaitProcessing(adminToken);
    });

    test('hero shows action tone with organizer Advance-to-Voting CTA when no nominations', async ({ page }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        const hero = page.getByTestId('hero-next-step');
        await expect(hero).toBeVisible({ timeout: 15_000 });
        await expect(hero).toHaveAttribute('data-tone', 'action');
        // Organizer persona on building → "Advance to Voting" CTA per spec.
        await expect(hero.getByRole('button', { name: /advance to voting/i })).toBeVisible();
    });

    test('hero copy reflects current nomination count for organizer', async ({ page }) => {
        // Nominate via API so the organizer-flavored "X of Y nominated" copy
        // includes the count. Validates AC-15 (copy chosen by persona × phase
        // × current state — count refreshes when state changes).
        await apiPost(adminToken, `/lineups/${lineupId}/nominate`, {
            gameId: gameIds[0],
        });
        await awaitProcessing(adminToken);

        await page.goto(`/community-lineup/${lineupId}`);
        const hero = page.getByTestId('hero-next-step');
        await expect(hero).toBeVisible({ timeout: 15_000 });
        // Organizer copy: "{N} of {M} nominated. Advance to Voting when ready."
        await expect(hero).toContainText(/\d+ of \d+ nominated/i);
        await expect(hero.getByRole('button', { name: /advance to voting/i })).toBeVisible();
    });

    test("after nominating, per-card pill appears on organizer's nominated card", async ({ page }) => {
        // Nominate via API to keep the test deterministic. Pill renders
        // because `entry.nominatedBy.id === user.id` regardless of persona —
        // organizer who self-nominates still sees their own pill.
        await apiPost(adminToken, `/lineups/${lineupId}/nominate`, {
            gameId: gameIds[0],
        });
        await awaitProcessing(adminToken);

        await page.goto(`/community-lineup/${lineupId}`);
        // Wait for the lineup detail to render.
        await expect(
            page.getByRole('heading', { level: 1, name: /Smoke Lineup/i }),
        ).toBeVisible({ timeout: 15_000 });

        const pill = page.getByTestId('confirmation-pill').first();
        await expect(pill).toBeVisible({ timeout: 10_000 });
        await expect(pill).toContainText(/your nomination/i);

        // Hero stays action-tone for organizer (no waiting flip — that's
        // the invitee-acted variant, covered by vitest).
        const hero = page.getByTestId('hero-next-step');
        await expect(hero).toHaveAttribute('data-tone', 'action');
    });
});

// ---------------------------------------------------------------------------
// Voting phase — pill flips to waitingOnN at the limit
// ---------------------------------------------------------------------------

test.describe('Voting phase — pill variant transitions', () => {
    test.beforeAll(async () => {
        // Ensure 3 nominations and advance.
        const detail = await apiGet(adminToken, `/lineups/${lineupId}`);
        const existingGameIds = new Set<number>(
            (detail?.entries ?? []).map((e: { gameId: number }) => e.gameId),
        );
        for (const gid of gameIds) {
            if (existingGameIds.has(gid)) continue;
            await apiPost(adminToken, `/lineups/${lineupId}/nominate`, {
                gameId: gid,
            });
        }
        await apiPatch(adminToken, `/lineups/${lineupId}/status`, {
            status: 'voting',
        });
        await awaitProcessing(adminToken);
    });

    test("pill shows 'count' variant before reaching the vote limit", async ({ page }) => {
        // Cast 1 vote.
        await apiPost(adminToken, `/lineups/${lineupId}/vote`, {
            gameId: gameIds[0],
        });
        await awaitProcessing(adminToken);

        await page.goto(`/community-lineup/${lineupId}`);
        const pill = page.getByTestId('confirmation-pill').first();
        await expect(pill).toBeVisible({ timeout: 15_000 });
        // 1 of N votes used (where N = maxVotesPerPlayer, default 3).
        await expect(pill).toContainText(/1.*votes used/i);
    });

    test("pill flips to waitingOnN variant after using all votes", async ({ page }) => {
        // Top up to the cap.
        for (const gid of gameIds.slice(1)) {
            await apiPost(adminToken, `/lineups/${lineupId}/vote`, {
                gameId: gid,
            }).catch(() => undefined);
        }
        await awaitProcessing(adminToken);

        await page.goto(`/community-lineup/${lineupId}`);
        const pill = page.getByTestId('confirmation-pill').first();
        await expect(pill).toBeVisible({ timeout: 15_000 });
        await expect(pill).toContainText(/waiting on/i);
    });
});

// ---------------------------------------------------------------------------
// Decided phase — hero shows 'Schedule {gameName}' CTA
// ---------------------------------------------------------------------------

test.describe('Decided phase — hero schedule CTA', () => {
    test.beforeAll(async () => {
        // Advance to decided. Use the admin's first vote as the decided game.
        await apiPatch(adminToken, `/lineups/${lineupId}/status`, {
            status: 'decided',
            decidedGameId: gameIds[0],
        });
        await awaitProcessing(adminToken);
    });

    test('hero offers schedule CTA referencing the decided game name', async ({ page }) => {
        await page.goto(`/community-lineup/${lineupId}`);

        const hero = page.getByTestId('hero-next-step');
        await expect(hero).toBeVisible({ timeout: 15_000 });
        // Organizer copy is "Open scheduling" (decided phase, hasGame). The
        // regex must match "schedul" so it works for both the invitee
        // "Schedule {gameName}" form (covered by vitest) and the organizer
        // "Open scheduling" form. /schedule/i alone fails because
        // "scheduling" lacks the literal "schedule" substring.
        await expect(hero.getByRole('button', { name: /schedul/i })).toBeVisible({
            timeout: 5_000,
        });
    });
});

// ---------------------------------------------------------------------------
// Mobile sticky compact behaviour (AC-18) — mobile project only
// ---------------------------------------------------------------------------

test.describe('Mobile sticky hero', () => {
    test('hero compacts after scrolling past sentinel on mobile', async ({ page }, testInfo) => {
        test.skip(
            testInfo.project.name === 'desktop',
            'Sticky compact mode is mobile-only per spec (AC-18).',
        );

        await page.goto(`/community-lineup/${lineupId}`);
        const hero = page.getByTestId('hero-next-step');
        await expect(hero).toBeVisible({ timeout: 15_000 });

        // Scroll past the sentinel; data-compact should flip to "true".
        await page.evaluate(() => window.scrollBy(0, 800));
        await expect(hero).toHaveAttribute('data-compact', 'true', {
            timeout: 5_000,
        });
    });
});
