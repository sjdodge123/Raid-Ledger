/**
 * My Events / Event Metrics dashboard smoke tests — page load, stats,
 * dashboard tab, analytics tab at desktop and mobile viewports.
 */
import { test, expect } from './base';
import type { TestInfo } from '@playwright/test';
import {
    apiDelete,
    apiGet,
    apiPatch,
    apiPost,
    getAdminToken,
    pollForCondition,
} from './api-helpers';
import { isPhoneLayout } from './helpers';

// ---------------------------------------------------------------------------
// ROK-1938 late-metric seed: one late, one full, one no-show player
// ---------------------------------------------------------------------------

interface ReliabilityUser { userId: number; username: string; lateCount?: number }
interface LateSeed { eventId: number | null; lateUser: ReliabilityUser | null }

const HOUR_MS = 3_600_000;
const PROJECT_SLOT: Record<string, number> = { desktop: 0, mobile: 1, tablet: 2 };

/** Same query the leaderboard issues, so the picked user is a rendered row. */
async function fetchLeaderboard(token: string): Promise<ReliabilityUser[]> {
    const res = (await apiGet(token, '/analytics/attendance/users?limit=50&offset=0')) as
        | { users?: ReliabilityUser[] }
        | null;
    return res?.users ?? [];
}

interface ListedUser { id: number; username: string; role?: string }

/**
 * Three distinct users per project from the player list (which always has the
 * demo users, unlike the leaderboard, which is empty until attendance exists).
 * Sorted by id, admins skipped, one disjoint window per project so the
 * concurrent desktop/mobile/tablet workers never seed the same player.
 */
async function pickUsers(token: string, testInfo: TestInfo): Promise<ReliabilityUser[]> {
    const res = (await apiGet(token, '/users?limit=50')) as { data?: ListedUser[] } | null;
    const pool = (res?.data ?? [])
        .filter((u) => u.role !== 'admin' && u.username !== 'admin')
        .sort((a, b) => a.id - b.id);
    const needed = Object.keys(PROJECT_SLOT).length * 3;
    if (pool.length < needed) throw new Error(`need ${needed} non-admin users, /users returned ${pool.length}`);
    const slot = PROJECT_SLOT[testInfo.project.name] ?? 0;
    return pool.slice(slot * 3, slot * 3 + 3).map((u) => ({ userId: u.id, username: u.username }));
}

/** The user's current leaderboard lateCount; 0 when they have no row yet. */
async function lateCountOf(token: string, userId: number): Promise<number> {
    return (await fetchLeaderboard(token)).find((u) => u.userId === userId)?.lateCount ?? 0;
}

/** Any game id — the Per-Game Breakdown (Late % series) only counts events with a game. */
async function pickGameId(token: string): Promise<number> {
    const games = (await apiGet(token, '/admin/settings/games')) as { data?: Array<{ id: number }> } | null;
    const gameId = games?.data?.[0]?.id;
    if (typeof gameId !== 'number') throw new Error(`GET /admin/settings/games returned no game: ${JSON.stringify(games)}`);
    return gameId;
}

/** Future event (signups refuse past events) — moved into the past after signup. */
async function createSeedEvent(token: string, testInfo: TestInfo): Promise<number> {
    const start = new Date(Date.now() + 2 * 86_400_000);
    const event = (await apiPost(token, '/events', {
        title: `smoke-rok1938-late-${testInfo.project.name}-${Date.now()}`,
        gameId: await pickGameId(token),
        startTime: start.toISOString(),
        endTime: new Date(start.getTime() + 2 * HOUR_MS).toISOString(),
        maxAttendees: 10,
    })) as { id?: number };
    if (typeof event.id !== 'number') throw new Error(`POST /events returned no id: ${JSON.stringify(event)}`);
    return event.id;
}

async function signUp(token: string, eventId: number, userId: number): Promise<number> {
    const res = (await apiPost(token, '/admin/test/signup', { eventId, userId })) as { id?: number };
    if (typeof res.id !== 'number') throw new Error(`/admin/test/signup returned no id: ${JSON.stringify(res)}`);
    return res.id;
}

/** Late: joins 30 min in (grace is 5) for 90 of 120 min. Full: start → end. */
async function injectSessions(token: string, eventId: number, late: number, full: number, slot: number) {
    const start = Date.now() - 3 * HOUR_MS;
    const end = start + 2 * HOUR_MS;
    const sessions = [
        { userId: late, joinAt: start + HOUR_MS / 2, durationSec: 5400, n: 1 },
        { userId: full, joinAt: start, durationSec: 7200, n: 2 },
    ];
    await apiPost(token, '/admin/test/set-event-times', {
        eventId, startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString(),
    });
    for (const s of sessions) {
        await apiPost(token, '/admin/test/inject-voice-session', {
            eventId, userId: s.userId, durationSec: s.durationSec,
            discordUserId: `19380000000000000${slot}${s.n}`,
            firstJoinAt: new Date(s.joinAt).toISOString(), lastLeaveAt: new Date(end).toISOString(),
        });
    }
}

/** Seeds the event; claims `seed.eventId` before anything can throw past it. */
async function seedLateEvent(token: string, testInfo: TestInfo, seed: LateSeed): Promise<void> {
    const [late, full, noShow] = await pickUsers(token, testInfo);
    if (!late || !full || !noShow) throw new Error('pickUsers returned fewer than 3 users');
    const baseline = await lateCountOf(token, late.userId);
    const fullBaseline = await lateCountOf(token, full.userId);
    seed.eventId = await createSeedEvent(token, testInfo);
    const eventId = seed.eventId;
    await signUp(token, eventId, late.userId);
    await signUp(token, eventId, full.userId);
    const noShowSignup = await signUp(token, eventId, noShow.userId);
    await injectSessions(token, eventId, late.userId, full.userId, PROJECT_SLOT[testInfo.project.name] ?? 0);
    await apiPost(token, '/admin/test/trigger-classify', { eventId });
    // Organiser's manual mark: a web signup has no Discord id, so classify never no-shows it.
    await apiPatch(token, `/events/${eventId}/attendance`, { signupId: noShowSignup, attendanceStatus: 'no_show' });
    seed.lateUser = await pollForCondition(async () => {
        const rows = await fetchLeaderboard(token);
        const row = rows.find((u) => u.userId === late.userId);
        const fullRow = rows.find((u) => u.userId === full.userId);
        const lateOk = row !== undefined && (row.lateCount ?? 0) === baseline + 1;
        const fullOk = fullRow !== undefined && (fullRow.lateCount ?? 0) === fullBaseline;
        return lateOk && fullOk ? row : null;
    }, {
        description: `late user ${late.userId} lateCount ${baseline}→${baseline + 1}, full user ${full.userId} stays ${fullBaseline}`,
        timeoutMs: 20_000,
    });
}

// ---------------------------------------------------------------------------
// Dashboard Tab (default view)
// ---------------------------------------------------------------------------

test.describe('My Events dashboard', () => {
    test('page renders heading and stats content', async ({ page }) => {
        await page.goto('/event-metrics');
        await expect(
            page.getByRole('heading', { name: 'Event Metrics' }),
        ).toBeVisible({ timeout: 15_000 });

        // Stats row renders four stat cards with known labels.
        // The stat labels are <p> text inside stat card divs.
        await expect(page.getByText('Upcoming', { exact: true })).toBeVisible({
            timeout: 10_000,
        });
        await expect(page.getByText('Signups', { exact: true })).toBeVisible();
        await expect(page.getByText('Avg Fill', { exact: true })).toBeVisible();
        await expect(
            page.getByText('Needs Attention', { exact: true }),
        ).toBeVisible();
    });

    test('event cards grid and activity feed are visible', async ({ page }) => {
        await page.goto('/event-metrics');
        await expect(
            page.getByRole('heading', { name: 'Event Metrics' }),
        ).toBeVisible({ timeout: 15_000 });

        // Admin sees "All Upcoming Events"; non-admin sees "Your Events".
        // Demo user is admin, so assert admin heading.
        await expect(
            page.getByRole('heading', { name: 'All Upcoming Events' }),
        ).toBeVisible({ timeout: 10_000 });

        // Recent Activity section
        await expect(
            page.getByRole('heading', { name: 'Recent Activity' }),
        ).toBeVisible();
    });

    test('tab switcher shows Dashboard and Analytics tabs', async ({ page }) => {
        await page.goto('/event-metrics');
        await expect(
            page.getByRole('heading', { name: 'Event Metrics' }),
        ).toBeVisible({ timeout: 15_000 });

        // Admin user sees tab switcher with Dashboard and Analytics buttons
        const dashboardTab = page.getByRole('button', { name: 'Dashboard' });
        const analyticsTab = page.getByRole('button', { name: 'Analytics' });

        await expect(dashboardTab).toBeVisible({ timeout: 10_000 });
        await expect(analyticsTab).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Analytics Tab
// ---------------------------------------------------------------------------

test.describe('My Events analytics tab', () => {
    test('clicking Analytics tab shows analytics sections', async ({ page }) => {
        await page.goto('/event-metrics');
        await expect(
            page.getByRole('heading', { name: 'Event Metrics' }),
        ).toBeVisible({ timeout: 15_000 });

        // Switch to Analytics tab
        await page.getByRole('button', { name: 'Analytics' }).click();

        // Verify all four analytics sections render their headings
        await expect(
            page.getByRole('heading', { name: 'Attendance Trends' }),
        ).toBeVisible({ timeout: 10_000 });
        await expect(
            page.getByRole('heading', { name: 'Reliability Leaderboard' }),
        ).toBeVisible();
        await expect(
            page.getByRole('heading', { name: 'Per-Game Breakdown' }),
        ).toBeVisible();
        await expect(
            page.getByRole('heading', { name: 'No-Show Patterns' }),
        ).toBeVisible();

        // Attendance Trends has period toggle buttons
        await expect(
            page.getByRole('button', { name: '30 Days' }),
        ).toBeVisible();
        await expect(
            page.getByRole('button', { name: '90 Days' }),
        ).toBeVisible();
    });

    test.describe('ROK-1938 Late metric', () => {
        const seed: LateSeed = { eventId: null, lateUser: null };
        let token = '';

        test.beforeAll(async ({}, testInfo) => {
            token = await getAdminToken();
            await seedLateEvent(token, testInfo, seed);
        });

        test.afterAll(async () => {
            if (seed.eventId !== null) await apiDelete(token, `/events/${seed.eventId}`);
            seed.eventId = null;
        });

        test('analytics: Late column and Late % series', async ({ page }, testInfo) => {
            const lateUser = seed.lateUser;
            if (!lateUser) throw new Error('late seed did not complete');
            await page.goto('/event-metrics');
            await expect(page.getByRole('heading', { name: 'Event Metrics' })).toBeVisible({ timeout: 15_000 });
            await page.getByRole('button', { name: 'Analytics' }).click();

            const lateHeader = page.getByRole('columnheader', { name: /^Late/ });
            if (isPhoneLayout(testInfo)) await expect(lateHeader).toBeAttached({ timeout: 10_000 });
            else await expect(lateHeader).toBeVisible({ timeout: 10_000 });

            // Columns: # · Player · Events · Attendance % · Late · No-Shows → Late is cell 4.
            const row = page.getByRole('row').filter({
                has: page.getByRole('cell', { name: lateUser.username, exact: true }),
            });
            await expect(row.getByRole('cell').nth(4)).toHaveText(String(lateUser.lateCount ?? 0));
            await expect(page.getByText(/^Attendance % includes late arrivals\./)).toBeVisible();

            await expect(page.getByText('Late %', { exact: true }).first()).toBeVisible();
            await expect(page.getByText(/^Late % is part of Attendance %\./)).toBeVisible();
        });
    });
});
