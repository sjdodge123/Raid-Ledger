/**
 * Hub forum smoke (ROK-1175) — desktop, tablet AND mobile.
 *
 * Every test seeds this caller's tagged community-hubs fixture on the tag's
 * own disabled game (`seedCommunityHubs … { dedicatedGame: true }`, so no
 * IGDB-renamed game name is ever read), then replaces the crew hub's forum with
 * `POST /admin/test/hubs/:id/forum/seed { memberUserId }`:
 *   - "Read me first: forum rules" — pinned, by the admin (leader/moderator);
 *   - "Raid comp for Tuesday" — by the member, one live reply + one removed;
 *   - "Old idea (edit window closed)" — by the member, 25 h old.
 * The crew member acting for this project signs in through a magic session.
 *
 *  1. The Forum tab lists the pinned thread first, then the rest by activity.
 *  2. A member starts a thread (title + body) and lands on its thread view,
 *     then replies and the reply shows.
 *  3. A deep link `/hubs/:id?thread=<id>#forum` opens that thread directly.
 *
 * Every write is confirmed by polling the API — the first render is never
 * trusted (memory `feedback_smoke_polling_for_async_writes`).
 */
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiGet, apiPost, getAdminToken } from './api-helpers';
import { seedCommunityHubs } from './hub-seed';
import { signInOnboardedMember } from './browser-session';
import { editorTextbox } from './hub-post-editor';

interface Seed {
    hubIds: { crew: number };
    /** `[officer, member-1, member-2, member-3, member-4]`. */
    memberUserIds: number[];
}

interface ForumSeed {
    pinnedThreadId: number;
    memberThreadId: number;
    staleThreadId: number;
}

interface ThreadSummary { id: number; title: string }

interface ThreadList { pinned: ThreadSummary[]; threads: ThreadSummary[] }

interface ThreadDetail { id: number; title: string; body: string; replies: Array<{ body: string }> }

const PINNED_TITLE = 'Read me first: forum rules';
const MEMBER_TITLE = 'Raid comp for Tuesday';
const STALE_TITLE = 'Old idea (edit window closed)';
const PROJECT_SLOT: Record<string, number> = { desktop: 0, mobile: 1, tablet: 2 };
/** The toolbar "New thread" shows from 768px (`hidden md:inline-flex`); below it the FAB. */
const TOOLBAR_MIN_WIDTH = 768;

/** Fail loudly on a missing element (strict flags: no `!`). */
function must<T>(value: T | undefined | null, label: string): T {
    if (value === undefined || value === null) throw new Error(`[hub-forum] missing ${label}`);
    return value;
}

/** This project's crew member actor: member-1 / member-2 / member-3. */
function actorId(seed: Seed, testInfo: TestInfo): number {
    return must(seed.memberUserIds[1 + (PROJECT_SLOT[testInfo.project.name] ?? 0)], 'actor member id');
}

/** Seed the crew hub + its forum; sign the project's crew member in. */
async function seedForum(page: Page, testInfo: TestInfo): Promise<{ hubId: number; forum: ForumSeed; jwt: string }> {
    const admin = await getAdminToken();
    const body = (await seedCommunityHubs(admin, testInfo, 'hub-forum', { dedicatedGame: true })) as Partial<Seed> | null;
    if (!body?.hubIds || typeof body.hubIds.crew !== 'number' || !Array.isArray(body.memberUserIds)) {
        throw new Error(`[hub-forum] community-hubs seed: ${JSON.stringify(body)}`);
    }
    const seed = body as Seed;
    const hubId = seed.hubIds.crew;
    const memberUserId = actorId(seed, testInfo);
    const forum = (await apiPost(admin, `/admin/test/hubs/${hubId}/forum/seed`, { memberUserId })) as Partial<ForumSeed> | null;
    if (typeof forum?.pinnedThreadId !== 'number' || typeof forum.memberThreadId !== 'number' || typeof forum.staleThreadId !== 'number') {
        throw new Error(`[hub-forum] forum seed: ${JSON.stringify(forum)}`);
    }
    const jwt = await signInOnboardedMember(page, memberUserId);
    return { hubId, forum: forum as ForumSeed, jwt };
}

async function forumList(jwt: string, hubId: number): Promise<ThreadList | null> {
    return (await apiGet(jwt, `/guilds/${hubId}/forum`)) as ThreadList | null;
}

async function forumThread(jwt: string, hubId: number, threadId: number): Promise<ThreadDetail | null> {
    return (await apiGet(jwt, `/guilds/${hubId}/forum/${threadId}`)) as ThreadDetail | null;
}

async function openForumList(page: Page, hubId: number): Promise<void> {
    await page.goto(`/hubs/${hubId}#forum`);
    await expect(page.getByTestId('hub-forum-list'), 'the Forum tab shows its thread list').toBeVisible({ timeout: 20_000 });
}

/** "New thread": the toolbar button at ≥768px, the FAB below it. */
async function startNewThread(page: Page): Promise<void> {
    const width = page.viewportSize()?.width ?? 0;
    const trigger = width >= TOOLBAR_MIN_WIDTH
        ? page.getByTestId('forum-new-thread')
        : page.getByRole('button', { name: 'New thread', exact: true });
    await expect(trigger, `the "New thread" control at ${width}px`).toBeVisible({ timeout: 15_000 });
    await trigger.click();
    await expect(page.getByTestId('hub-forum-composer'), 'New thread opens the composer').toBeVisible({ timeout: 15_000 });
}

/** Type `text` into the lazy markdown editor whose frame carries `testId`. */
async function typeInEditor(page: Page, testId: string, text: string): Promise<void> {
    const box = await editorTextbox(page, page.getByTestId(testId));
    await box.click();
    await page.keyboard.type(text);
    await expect(box, `the ${testId} editor holds the typed text`).toContainText(text);
}

/** The `?thread=<id>` of the current URL. */
function threadIdFromUrl(page: Page): number {
    const raw = new URL(page.url()).searchParams.get('thread');
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) throw new Error(`[hub-forum] no ?thread= id in ${page.url()}`);
    return id;
}

test.describe('hub forum', () => {
    test('Forum tab lists the pinned thread first, then threads by latest activity', async ({ page }, testInfo) => {
        const { hubId, forum, jwt } = await seedForum(page, testInfo);
        await expect
            .poll(async () => {
                const list = await forumList(jwt, hubId);
                return [list?.pinned.map((t) => t.id) ?? [], list?.threads.map((t) => t.id) ?? []];
            }, { message: 'the API lists the seeded pinned thread, then member + stale by activity', timeout: 15_000 })
            .toEqual([[forum.pinnedThreadId], [forum.memberThreadId, forum.staleThreadId]]);

        await openForumList(page, hubId);
        const list = page.getByTestId('hub-forum-list');
        await expect(list.getByTestId('forum-thread-title'), 'pinned first, then latest activity').toHaveText(
            [PINNED_TITLE, MEMBER_TITLE, STALE_TITLE],
            { timeout: 15_000 },
        );
        const pinnedRow = list.getByTestId('forum-thread-row').first();
        await expect(pinnedRow, 'the first row is the pinned thread').toContainText(PINNED_TITLE);
        await expect(pinnedRow.getByText('Pinned', { exact: true }), 'the pinned row carries the Pinned pill').toBeVisible();
    });

    test('a member starts a thread, lands on it, and replies', async ({ page, world }, testInfo) => {
        const { hubId, jwt } = await seedForum(page, testInfo);
        const title = `Smoke thread ${world.uid('forum')}`.slice(0, 120);
        const body = `Opening post ${world.uid('body')}`;
        const reply = `First reply ${world.uid('reply')}`;

        await openForumList(page, hubId);
        await startNewThread(page);
        await page.getByTestId('forum-title-input').fill(title);
        await typeInEditor(page, 'forum-body-input', body);
        await page.getByTestId('forum-thread-submit').click();

        await page.waitForURL(/[?&]thread=\d+/, { timeout: 15_000 });
        const threadId = threadIdFromUrl(page);
        await expect
            .poll(async () => (await forumThread(jwt, hubId, threadId))?.title, { message: 'the API stored the new thread', timeout: 15_000 })
            .toBe(title);
        const view = page.getByTestId('hub-forum-thread');
        await expect(view, 'posting lands on the new thread view').toBeVisible({ timeout: 15_000 });
        await expect(view.getByTestId('forum-thread-heading')).toHaveText(title);
        await expect(view.getByTestId('forum-thread-root'), 'the root post shows the body').toContainText(body);

        await typeInEditor(page, 'forum-reply-input', reply);
        await page.getByTestId('forum-reply-submit').click();
        await expect
            .poll(async () => (await forumThread(jwt, hubId, threadId))?.replies.map((r) => r.body) ?? [], {
                message: 'the API stored the reply',
                timeout: 15_000,
            })
            .toContain(reply);
        await expect(view.getByTestId('forum-reply').filter({ hasText: reply }), 'the reply shows under the thread').toBeVisible({
            timeout: 15_000,
        });
    });

    test('a deep link ?thread=<id>#forum opens that thread', async ({ page }, testInfo) => {
        const { hubId, forum } = await seedForum(page, testInfo);
        await page.goto(`/hubs/${hubId}?thread=${forum.memberThreadId}#forum`);

        const view = page.getByTestId('hub-forum-thread');
        await expect(view, 'the deep link opens the thread view, not the list').toBeVisible({ timeout: 20_000 });
        await expect(view.getByTestId('forum-thread-heading')).toHaveText(MEMBER_TITLE);
        await expect(view.getByTestId('forum-thread-root'), 'the root post renders its markdown body').toContainText('Who is bringing a healer?');
        await expect(view.getByTestId('forum-reply').first(), 'the live seeded reply shows').toContainText('Two healers, one tank.');

        await view.getByTestId('forum-back').click();
        await expect(page.getByTestId('hub-forum-list'), 'Back returns to the thread list').toBeVisible({ timeout: 15_000 });
    });
});
