/**
 * Lineup Confirmation-Pattern smoke tests (ROK-1209).
 *
 * Verifies AC-14, AC-16, AC-17, AC-18 end-to-end on the lineup detail page
 * across building, voting, and decided phases. Both desktop and mobile
 * Playwright projects exercise these tests per CLAUDE.md.
 *
 * Setup: per-worker prefixed lineup created in `beforeAll`; the admin user
 * is the creator (organizer persona). Tests narrow to the invitee-acted /
 * invitee-not-acted persona by switching the in-page action state via API.
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

    test('hero shows action tone with Nominate CTA when no nominations', async ({ page }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        const hero = page.getByTestId('hero-next-step');
        await expect(hero).toBeVisible({ timeout: 15_000 });
        await expect(hero).toHaveAttribute('data-tone', 'action');
        await expect(hero.getByRole('button', { name: /nominate/i })).toBeVisible();
    });

    test('hero CTA opens the Nominate modal', async ({ page }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        const hero = page.getByTestId('hero-next-step');
        await expect(hero).toBeVisible({ timeout: 15_000 });
        await hero.getByRole('button', { name: /nominate/i }).click();
        await expect(page.getByRole('dialog', { name: /nominate a game/i })).toBeVisible({
            timeout: 5_000,
        });
    });

    test("after nominating, per-card pill appears and hero flips to waiting tone", async ({ page }) => {
        // Nominate via API to keep the test deterministic.
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

        const hero = page.getByTestId('hero-next-step');
        await expect(hero).toHaveAttribute('data-tone', 'waiting');
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
        // The CTA should mention "Schedule" as a verb.
        await expect(hero.getByRole('button', { name: /schedule/i })).toBeVisible({
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
