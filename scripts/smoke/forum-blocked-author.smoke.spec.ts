/**
 * Forum blocked-author smoke (ROK-2328) — every configured project (desktop + mobile).
 *
 * A banned (or deactivated) author's forum posts stay linked server-side but the
 * web shows them as "Deactivated member" with no avatar (operator ruling).
 *
 * Setup copies `hub-forum.smoke.spec.ts`: this project's tagged community-hubs
 * fixture (its own members, so no other spec holds their tokens), then
 * `POST /admin/test/hubs/:id/forum/seed { memberUserId }` makes "Raid comp for
 * Tuesday" a thread authored by this project's member. The admin bans that
 * member through the real `POST /users/:id/ban`; the hub officer (never banned)
 * then views the forum. The banned member never signs in, so the shared-token
 * `blockUser` trap cannot bite; the ban is lifted in `finally`.
 *
 * Every write is confirmed by polling the API before the UI is asserted.
 */
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiGet, apiPost, getAdminToken } from './api-helpers';
import { seedCommunityHubs } from './hub-seed';
import { signInOnboardedMember } from './browser-session';

interface Seed {
    hubIds: { crew: number };
    /** `[officer, member-1, member-2, member-3, member-4]`. */
    memberUserIds: number[];
}

interface Person { userId: number; displayName: string; blocked?: string | null }

interface ThreadDetail { id: number; title: string; author: Person | null }

interface Fixture { admin: string; hubId: number; threadId: number; authorId: number; officerId: number }

const MEMBER_TITLE = 'Raid comp for Tuesday';
const BLOCKED_NAME = 'Deactivated member';
const PROJECT_SLOT: Record<string, number> = { desktop: 0, mobile: 1, tablet: 2 };

/** Fail loudly on a missing element (strict flags: no `!`). */
function must<T>(value: T | undefined | null, label: string): T {
    if (value === undefined || value === null) throw new Error(`[forum-blocked-author] missing ${label}`);
    return value;
}

/** Seed this project's crew hub + forum; the thread author is this project's member. */
async function seedFixture(testInfo: TestInfo): Promise<Fixture> {
    const admin = await getAdminToken();
    const body = (await seedCommunityHubs(admin, testInfo, 'forum-blocked-author', { dedicatedGame: true })) as Partial<Seed> | null;
    if (!body?.hubIds || typeof body.hubIds.crew !== 'number' || !Array.isArray(body.memberUserIds)) {
        throw new Error(`[forum-blocked-author] community-hubs seed: ${JSON.stringify(body)}`);
    }
    const hubId = body.hubIds.crew;
    const officerId = must(body.memberUserIds[0], 'officer id');
    const authorId = must(body.memberUserIds[1 + (PROJECT_SLOT[testInfo.project.name] ?? 0)], 'author member id');
    // A retried run may find the member still banned; lift it before seeding.
    await apiPost(admin, `/users/${authorId}/unban`);
    const forum = (await apiPost(admin, `/admin/test/hubs/${hubId}/forum/seed`, { memberUserId: authorId })) as
        { memberThreadId?: unknown } | null;
    if (typeof forum?.memberThreadId !== 'number') {
        throw new Error(`[forum-blocked-author] forum seed: ${JSON.stringify(forum)}`);
    }
    return { admin, hubId, threadId: forum.memberThreadId, authorId, officerId };
}

async function threadDetail(jwt: string, hubId: number, threadId: number): Promise<ThreadDetail | null> {
    return (await apiGet(jwt, `/guilds/${hubId}/forum/${threadId}`)) as ThreadDetail | null;
}

/** Ban through the real moderation route and fail on any error body. */
async function banAuthor(admin: string, authorId: number): Promise<void> {
    const res = (await apiPost(admin, `/users/${authorId}/ban`, { reason: 'ROK-2328 smoke' })) as { statusCode?: number } | null;
    if (typeof res?.statusCode === 'number' && res.statusCode >= 400) {
        throw new Error(`[forum-blocked-author] POST /users/${authorId}/ban: ${JSON.stringify(res)}`);
    }
}

/** The seeded author's real name, read before the ban so the UI can be checked against it. */
async function authorName(fx: Fixture, viewerJwt: string): Promise<string> {
    const detail = await threadDetail(viewerJwt, fx.hubId, fx.threadId);
    expect(detail?.author?.userId, 'the seeded thread is authored by this project member').toBe(fx.authorId);
    return must(detail?.author?.displayName, 'author displayName');
}

async function openThread(page: Page, fx: Fixture): Promise<void> {
    await page.goto(`/hubs/${fx.hubId}?thread=${fx.threadId}#forum`);
    await expect(page.getByTestId('hub-forum-thread'), 'the deep link opens the thread view').toBeVisible({ timeout: 20_000 });
}

test.describe('hub forum — banned author', () => {
    test('a banned author shows as Deactivated member with no avatar in the thread view and list', async ({ page }, testInfo) => {
        const fx = await seedFixture(testInfo);
        const viewerJwt = await signInOnboardedMember(page, fx.officerId);
        const realName = await authorName(fx, viewerJwt);
        try {
            await banAuthor(fx.admin, fx.authorId);
            await expect
                .poll(async () => (await threadDetail(viewerJwt, fx.hubId, fx.threadId))?.author?.blocked ?? null, {
                    message: 'the API marks the thread author as banned (still linked)',
                    timeout: 15_000,
                })
                .toBe('banned');

            await openThread(page, fx);
            const root = page.getByTestId('hub-forum-thread').getByTestId('forum-thread-root');
            await expect(root, 'the root post byline reads Deactivated member').toContainText(BLOCKED_NAME, { timeout: 15_000 });
            await expect(root, 'the root post never shows the banned name').not.toContainText(realName);
            await expect(root.locator('img'), 'the root post byline has no avatar image').toHaveCount(0);

            await page.getByTestId('forum-back').click();
            const row = page.getByTestId('hub-forum-list').getByTestId('forum-thread-row').filter({ hasText: MEMBER_TITLE });
            await expect(row, 'the thread row reads Deactivated member').toContainText(BLOCKED_NAME, { timeout: 15_000 });
            await expect(row, 'the thread row never shows the banned name').not.toContainText(realName);
            await expect(row.locator('img'), 'the thread row has no avatar image').toHaveCount(0);
        } finally {
            await apiPost(fx.admin, `/users/${fx.authorId}/unban`);
        }
    });
});
