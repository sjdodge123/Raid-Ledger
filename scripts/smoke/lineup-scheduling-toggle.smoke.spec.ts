/**
 * ROK-1302 — Start Lineup scheduling-phase toggle smoke test.
 *
 * A lineup created with the "Include scheduling phase" toggle OFF terminates at
 * Decided: the per-match "Pick a time →" CTA must NOT appear. A control lineup
 * (toggle ON / default) keeps the CTA. Runs on desktop + mobile projects.
 *
 * Requires DEMO_MODE=true and an authenticated admin (global setup).
 */
import { test, expect } from './base';
import {
    getAdminToken,
    apiGet,
    apiPatch,
    createLineupOrRetry,
    API_BASE,
} from './api-helpers';

async function apiPost(
    token: string,
    path: string,
    body?: Record<string, unknown>,
) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`POST ${path} failed: ${res.status} ${text}`);
    }
    return res.json();
}

const FILE_PREFIX = 'lineup-scheduling-toggle';
let workerPrefix: string;
let adminToken: string;
let offLineupId: number;
let onLineupId: number;

async function fetchGameIds(token: string, count: number): Promise<number[]> {
    const data = await apiGet(token, '/admin/settings/games');
    if (!data?.data?.length)
        throw new Error('No games in DB — seed data missing');
    return data.data.slice(0, count).map((g: { id: number }) => g.id);
}

/** Build a decided lineup, parameterized by the scheduling-phase toggle. */
async function setupDecidedLineup(
    token: string,
    includeSchedulingPhase: boolean,
    label: string,
): Promise<number> {
    const gameIds = await fetchGameIds(token, 2);
    const { id: lineupId } = await createLineupOrRetry(
        token,
        {
            title: `${workerPrefix}${label}`,
            buildingDurationHours: 720,
            votingDurationHours: 720,
            decidedDurationHours: 720,
            matchThreshold: 10,
            includeSchedulingPhase,
        },
        workerPrefix,
    );
    await Promise.all(
        gameIds.map((gid) =>
            apiPost(token, `/lineups/${lineupId}/nominate`, { gameId: gid }),
        ),
    );
    await apiPatch(token, `/lineups/${lineupId}/status`, { status: 'voting' });
    await apiPost(token, `/lineups/${lineupId}/vote`, { gameId: gameIds[0] });
    await apiPatch(token, `/lineups/${lineupId}/status`, {
        status: 'decided',
        decidedGameId: gameIds[0],
    });
    return lineupId;
}

test.beforeAll(async ({}, testInfo) => {
    workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
    adminToken = await getAdminToken();
    await apiPost(adminToken, '/admin/test/reset-lineups', {
        titlePrefix: workerPrefix,
    });
    offLineupId = await setupDecidedLineup(adminToken, false, 'Sched OFF');
    onLineupId = await setupDecidedLineup(adminToken, true, 'Sched ON');
});

async function gotoDecided(
    page: import('@playwright/test').Page,
    lineupId: number,
): Promise<void> {
    await page.goto(`/community-lineup/${lineupId}`);
    await expect(page.getByTestId('decided-composite-view')).toBeVisible({
        timeout: 20_000,
    });
}

test.describe('Lineup scheduling toggle — decided CTA (ROK-1302)', () => {
    test('hides the "Pick a time" CTA when scheduling is disabled', async ({
        page,
    }) => {
        await gotoDecided(page, offLineupId);
        // The decided view + a personal match render, but no schedule CTA.
        await expect(
            page.getByTestId('decided-your-matches-section'),
        ).toBeVisible({ timeout: 15_000 });
        await expect(
            page.getByRole('link', { name: /pick a time/i }),
        ).toHaveCount(0);
    });

    test('shows the "Pick a time" CTA when scheduling is enabled (control)', async ({
        page,
    }) => {
        await gotoDecided(page, onLineupId);
        const cta = page
            .getByTestId('decided-your-matches-section')
            .getByRole('link', { name: /pick a time/i })
            .first();
        await expect(cta).toBeVisible({ timeout: 15_000 });
    });
});
