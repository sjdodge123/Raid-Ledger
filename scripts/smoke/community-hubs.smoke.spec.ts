/**
 * Game community hubs smoke (ROK-1870 §4) — desktop, tablet AND mobile.
 *
 * Every test re-seeds through the DEMO_MODE fixture
 * `POST /admin/test/community-hubs/seed {gameId}` (§2.6): on its game it
 * resets its own fixture (seed-named hubs, hubs proposed/led by a seed user,
 * their members, bans and notices; seed users are reused, never recreated, and
 * their Discord DMs muted) and recreates "Seed Crew" (leader + officer
 * + 4 members + a ban), "Seed Solo" (its leader only), "Seed Hopefuls"
 * (`proposed` by `demo-member`) and "Seed Old Guard" (archived). The projects
 * run in parallel, so each one seeds a DIFFERENT configured game (the seed
 * clears by game) and acts through a different crew member (proposal limits
 * are per user across games, D12). The seeded users are A2-eligible (Discord id
 * + `guild_member_seen_at`); each signs in with its own session and its own JWT
 * drives the API reads. Every write is confirmed by polling the API — the first
 * render is never trusted (memory `feedback_smoke_polling_for_async_writes`).
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { API_BASE, apiDelete, apiGet, apiPatch, apiPost, getAdminToken, pollForCondition } from './api-helpers';
import { signInOnboardedMember } from './browser-session';

interface Seed {
    gameId: number;
    /** ROK-1883: `server` is a HIDDEN game-server hub, `guild` a member-less WoW guild hub. */
    hubIds: { crew: number; solo: number; archived: number; server: number; guild: number };
    leaderUserId: number;
    /** `[officer, member-1, member-2, member-3, member-4]`. */
    memberUserIds: number[];
    bannedUserId: number;
    proposalId: number;
}

interface DirectoryEntry {
    id: number;
    name: string;
    blurb: string | null;
    memberCount: number;
    viewer: string;
}

interface GameHubsBody {
    hubs: DirectoryEntry[];
    myProposals: Array<{ id: number; name: string }>;
}

interface NotificationRow {
    type: string;
    title?: string;
    payload?: Record<string, unknown>;
}

/** Header `md:` — from 768px the header carries the Hubs item (ROK-1875); below it the More drawer. */
const HEADER_HUBS_MIN_WIDTH = 768;
const ADMIN_HUBS_PATH = '/admin/settings/general/hubs';
const PROJECT_SLOT: Record<string, number> = { desktop: 0, mobile: 1, tablet: 2 };

/** Fail loudly on a missing element (strict flags: no `!`). */
function must<T>(value: T | undefined | null, label: string): T {
    if (value === undefined || value === null) throw new Error(`[community-hubs] missing ${label}`);
    return value;
}

function slotOf(testInfo: TestInfo): number {
    return PROJECT_SLOT[testInfo.project.name] ?? 0;
}

/** This project's crew member actor: member-1 / member-2 / member-3. */
function actorId(seed: Seed, testInfo: TestInfo): number {
    return must(seed.memberUserIds[1 + slotOf(testInfo)], 'actor member id');
}

/** One configured game per project, so parallel seeds never clear each other. */
async function projectGameId(token: string, testInfo: TestInfo): Promise<number> {
    const body = (await apiGet(token, '/games/configured')) as { data?: unknown } | unknown[] | null;
    const raw = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
    const ids = raw
        .map((g) => (g as { id?: unknown }).id)
        .filter((id): id is number => typeof id === 'number')
        .sort((a, b) => a - b);
    if (ids.length === 0) throw new Error('[community-hubs] GET /games/configured returned no games');
    return must(ids[slotOf(testInfo) % ids.length], 'project game id');
}

async function seedHubs(testInfo: TestInfo): Promise<Seed> {
    const token = await getAdminToken();
    const gameId = await projectGameId(token, testInfo);
    const body = (await apiPost(token, '/admin/test/community-hubs/seed', { gameId })) as Partial<Seed> | null;
    if (!body || typeof body.proposalId !== 'number' || !body.hubIds || !Array.isArray(body.memberUserIds)) {
        throw new Error(`[community-hubs] seed: ${JSON.stringify(body)}`);
    }
    return body as Seed;
}

/**
 * Install + activate a plugin through the real admin plugin API (the
 * `pelican-quick-play-switch.smoke.spec.ts` pattern). `game_server` hubs are
 * listed only while their owner, Pelican, is active (`HubKindRegistry.active`),
 * and nothing auto-installs it, so a run of this spec alone never lists the
 * seeded server hub without this. A failed install (already installed, or a
 * sibling worker won the race) falls through to activate, which must succeed.
 */
async function ensurePluginActive(token: string, pluginId: string): Promise<void> {
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } };
    const install = await fetch(`${API_BASE}/admin/plugins/${pluginId}/install`, init);
    if (install.ok) return;
    const activate = await fetch(`${API_BASE}/admin/plugins/${pluginId}/activate`, init);
    if (!activate.ok) throw new Error(`failed to enable the ${pluginId} plugin: install ${install.status}, activate ${activate.status}`);
}

async function gameHubs(jwt: string, gameId: number): Promise<GameHubsBody> {
    const res = (await apiGet(jwt, `/hubs/by-game/${gameId}`)) as GameHubsBody | null;
    return must(res, `GET /hubs/by-game/${gameId}`);
}

async function viewerOf(jwt: string, gameId: number, hubId: number): Promise<string | undefined> {
    return (await gameHubs(jwt, gameId)).hubs.find((h) => h.id === hubId)?.viewer;
}

async function hubEntry(jwt: string, gameId: number, hubId: number): Promise<DirectoryEntry | undefined> {
    return (await gameHubs(jwt, gameId)).hubs.find((h) => h.id === hubId);
}

/** Withdraw every open proposal a crashed earlier run may have left (D12 limits). */
async function withdrawAll(jwt: string): Promise<void> {
    const mine = (await apiGet(jwt, '/hubs/proposals/mine')) as { items?: Array<{ id: number }> } | null;
    for (const p of mine?.items ?? []) await apiDelete(jwt, `/hubs/proposals/${p.id}`).catch(() => undefined);
}

async function openGamePage(page: Page, gameId: number): Promise<Locator> {
    await page.goto(`/games/${gameId}`);
    const card = page.locator('section[aria-labelledby="game-hubs-heading"]');
    await expect(card, 'the game page renders the one Hubs card').toBeVisible({ timeout: 20_000 });
    await expect(card, 'exactly one Hubs card (ROK-1883)').toHaveCount(1);
    await expect(page.getByTestId('game-detail-guilds'), 'the WoW "Guilds" card is gone (ROK-1883)').toHaveCount(0);
    return card;
}

/** The hub's member-table row for `username`. */
function memberRow(page: Page, username: string): Locator {
    return page.getByTestId('guild-member-row').filter({ hasText: username });
}

/**
 * Open `username`'s Manage menu and pick `actionTestId` (e.g.
 * `community-member-make-officer`). From 1024px the menu is a `role="menu"`
 * dropdown inside the row; below it the same rows render in a `BottomSheet`
 * portal, so they are NOT descendants of the row. Both shells wrap the rows in
 * a `role="menu"` named "Manage <name>" and only one is open at a time, so the
 * action is located in the open menu wherever it renders (community-member-menu.tsx).
 */
async function memberAction(page: Page, username: string, actionTestId: string): Promise<void> {
    const trigger = memberRow(page, username).getByTestId('community-member-manage');
    await expect(trigger, `${username}'s Manage trigger is enabled`).toBeEnabled({ timeout: 15_000 });
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = page.getByRole('menu', { name: /^Manage / });
    await expect(menu, `the Manage menu for ${username} is open`).toHaveCount(1);
    await menu.getByTestId(actionTestId).click();
    await expect(menu, 'picking an action closes the menu / sheet').toHaveCount(0);
}

/** The seed's usernames for `memberUserIds` (demo-test-community-hubs.controller `CREW`). */
const CREW_USERNAMES = ['community-officer', 'community-member-1', 'community-member-2', 'community-member-3', 'community-member-4'];

function crewUsername(index: number): string {
    return must(CREW_USERNAMES[index], `crew username ${index}`);
}

test.describe('community hubs — member', () => {
    test('game page card lists the hubs; inline Join flips to Joined', async ({ page }, testInfo) => {
        const seed = await seedHubs(testInfo);
        const jwt = await signInOnboardedMember(page, actorId(seed, testInfo));
        const card = await openGamePage(page, seed.gameId);
        await expect(card.getByRole('link', { name: 'Seed Crew' })).toHaveAttribute('href', `/hubs/${seed.hubIds.crew}`);
        await expect(card.getByRole('link', { name: 'Seed Old Guard' }), 'archived hubs are not listed').toHaveCount(0);
        await expect(card.getByRole('link', { name: 'Seed Hopefuls' }), 'proposed hubs are not listed').toHaveCount(0);
        await expect(card.getByRole('link', { name: 'Seed Server', exact: true }), 'a member never sees a hidden server hub').toHaveCount(0);
        await expect(card.getByRole('link', { name: 'Seed Guild', exact: true }), 'a non-member never sees a WoW guild hub').toHaveCount(0);
        await expect(card.getByText('Hidden', { exact: true }), 'non-staff never see the Hidden chip').toHaveCount(0);

        await card.getByRole('button', { name: 'Join Seed Solo' }).click();
        await expect.poll(() => viewerOf(jwt, seed.gameId, seed.hubIds.solo), {
            message: 'the card Join must reach the API',
        }).toBe('member');
        const soloRow = card.locator('li', { has: page.getByRole('link', { name: 'Seed Solo' }) });
        await expect(soloRow.getByText('Joined')).toBeVisible();
        await expect(card.getByRole('button', { name: 'Join Seed Solo' })).toHaveCount(0);
    });

    test('propose a hub: the form lands in "Your proposals" as Pending review; Withdraw removes it', async ({ page }, testInfo) => {
        const seed = await seedHubs(testInfo);
        const jwt = await signInOnboardedMember(page, actorId(seed, testInfo));
        await withdrawAll(jwt);
        // Unique per project AND per run, so a stale row from an earlier run never clashes (D11).
        const name = `Smoke Hub ${testInfo.project.name} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const card = await openGamePage(page, seed.gameId);

        await card.getByRole('button', { name: 'Start a community hub' }).click();
        const dialog = page.getByRole('dialog', { name: 'Start a community hub' });
        await expect(dialog, 'Modal ≥1024px, BottomSheet below — both are named dialogs').toBeVisible();
        await dialog.getByLabel('Hub name').fill(name);
        await dialog.getByLabel('Short description').fill('A smoke-test hub proposal.');
        await page.getByRole('button', { name: 'Send for review' }).click();
        await expect(dialog).toBeHidden({ timeout: 15_000 });

        await expect.poll(async () => (await gameHubs(jwt, seed.gameId)).myProposals.map((p) => p.name), {
            message: 'the proposal must reach the API',
        }).toContain(name);
        const row = card.locator('li', { hasText: name });
        await expect(row.getByText('Pending review')).toBeVisible({ timeout: 15_000 });

        await row.getByRole('button', { name: 'Withdraw' }).click();
        await row.getByRole('button', { name: 'Yes, withdraw' }).click();
        await expect.poll(async () => (await gameHubs(jwt, seed.gameId)).myProposals.map((p) => p.name), {
            message: 'the withdraw must reach the API',
        }).not.toContain(name);
        await expect(card.locator('li', { hasText: name })).toHaveCount(0);
    });

    test('/hubs directory: game + membership filters persist in the URL, search narrows, inline Join', async ({ page }, testInfo) => {
        const seed = await seedHubs(testInfo);
        const jwt = await signInOnboardedMember(page, actorId(seed, testInfo));
        await page.goto(`/hubs?game=${seed.gameId}&membership=not-joined`);
        await expect(page.getByRole('heading', { name: 'Hubs', level: 1 })).toBeVisible({ timeout: 20_000 });
        const cards = page.getByTestId('hub-directory-card');
        await expect(cards.filter({ hasText: 'Seed Solo' }), 'not-joined lists the hub the actor is outside').toHaveCount(1, {
            timeout: 15_000,
        });
        await expect(cards.filter({ hasText: 'Seed Crew' }), 'not-joined hides the crew the actor is in').toHaveCount(0);

        await page.goto(`/hubs?game=${seed.gameId}`);
        await page.getByLabel('Search hubs').fill('Seed Crew');
        await expect(page).toHaveURL(/[?&]q=Seed(\+|%20)Crew/, { timeout: 15_000 });
        await expect(cards.filter({ hasText: 'Seed Solo' }), 'search narrows the list').toHaveCount(0, { timeout: 15_000 });
        await expect(cards.filter({ hasText: 'Seed Crew' })).toHaveCount(1);

        await page.goto(`/hubs?game=${seed.gameId}&q=Seed%20Solo`);
        await cards.filter({ hasText: 'Seed Solo' }).getByRole('button', { name: 'Join Seed Solo' }).click();
        await expect.poll(() => viewerOf(jwt, seed.gameId, seed.hubIds.solo), {
            message: 'the directory Join must reach the API',
        }).toBe('member');
    });

    test('hub page: Join, the Members tab lists the joiner, Leave', async ({ page }, testInfo) => {
        const seed = await seedHubs(testInfo);
        const jwt = await signInOnboardedMember(page, actorId(seed, testInfo));
        const username = crewUsername(1 + slotOf(testInfo));
        await page.goto(`/hubs/${seed.hubIds.solo}`);
        await expect(page.getByTestId('community-hub-kind')).toBeVisible({ timeout: 20_000 });

        await page.getByTestId('community-hub-join').click();
        await expect.poll(() => viewerOf(jwt, seed.gameId, seed.hubIds.solo), { message: 'Join must reach the API' }).toBe('member');
        await expect(page.getByTestId('community-hub-leave')).toBeVisible({ timeout: 15_000 });

        await page.goto(`/hubs/${seed.hubIds.solo}#members`);
        await expect(memberRow(page, username), 'the Members tab lists the new member').toHaveCount(1, { timeout: 15_000 });

        await page.getByTestId('community-hub-leave').click();
        await page.getByTestId('community-hub-leave-yes').click();
        await expect.poll(() => viewerOf(jwt, seed.gameId, seed.hubIds.solo), { message: 'Leave must reach the API' }).toBe(
            'not-member',
        );
        await expect(page.getByTestId('community-hub-join')).toBeVisible({ timeout: 15_000 });
    });

    test('nav: a hub member reaches /hubs via the header Hubs menu (≥768px) or the bottom Hubs sheet (phone)', async ({ page }, testInfo) => {
        const seed = await seedHubs(testInfo);
        await signInOnboardedMember(page, actorId(seed, testInfo));
        // Not /calendar: on phones it smooth-scrolls to today after mount, so useScrollDirection slides the
        // bottom bar off-screen and the trigger click times out "outside of the viewport". /players never
        // scrolls itself (same fix as hubs-nav.smoke.spec.ts NAV_START).
        await page.goto('/players');
        const width = page.viewportSize()?.width ?? 0;
        if (width >= HEADER_HUBS_MIN_WIDTH) {
            // ROK-1875: the actor is in Seed Crew, so the header Hubs item is a menu (not a plain link).
            const trigger = page.getByRole('navigation', { name: 'Main navigation' }).getByTestId('nav-hubs-menu-trigger');
            await expect(trigger, 'a hub member gets the Hubs menu in the header from 768px').toBeVisible({ timeout: 15_000 });
            await trigger.click();
            const browse = page.getByRole('menu', { name: 'Hubs' }).getByTestId('nav-hubs-browse-all');
            await expect(browse, '"Browse all hubs" closes the Hubs menu').toBeVisible({ timeout: 15_000 });
            await browse.click();
        } else {
            // ROK-1890: the More drawer no longer lists hubs; the bottom bar's Hubs sheet is the phone entry.
            const trigger = page.getByTestId('bottom-tab-bar').getByTestId('bottom-hubs-trigger');
            await expect(trigger, 'phone: a hub member gets the bottom Hubs sheet trigger').toBeVisible({ timeout: 15_000 });
            await trigger.click();
            const browse = page.getByRole('dialog', { name: 'Your hubs' }).getByTestId('bottom-hubs-browse-all');
            await expect(browse, 'phone: "Browse all hubs" in the bottom Hubs sheet').toBeVisible({ timeout: 15_000 });
            await browse.click();
        }
        await expect(page).toHaveURL(/\/hubs(?:[?#]|$)/);
        await expect(page.getByRole('heading', { name: 'Hubs', level: 1 })).toBeVisible({ timeout: 15_000 });
    });
});

test.describe('community hubs — signed out', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('the Hubs nav item is hidden for signed-out visitors', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('body')).toBeVisible();
        await expect(page.getByRole('link', { name: 'Hubs', exact: true }), 'no Hubs link without a session').toHaveCount(0);
        await expect(page.getByTestId('bottom-hubs-link'), 'no bottom Hubs link without a session').toHaveCount(0);
        await expect(page.getByTestId('bottom-hubs-trigger'), 'no bottom Hubs sheet without a session').toHaveCount(0);
    });
});

test.describe('community hubs — leader', () => {
    test('Manage menu: promote a member to officer, then remove them', async ({ page }, testInfo) => {
        const seed = await seedHubs(testInfo);
        const admin = await getAdminToken();
        const target = crewUsername(4);
        await signInOnboardedMember(page, seed.leaderUserId);
        await page.goto(`/hubs/${seed.hubIds.crew}#members`);
        const row = memberRow(page, target);
        await expect(row).toHaveCount(1, { timeout: 20_000 });

        await memberAction(page, target, 'community-member-make-officer');
        await expect(row.getByTestId('community-member-role'), 'the promotion refetches the row').toHaveText(/officer/i, {
            timeout: 15_000,
        });
        await page.reload();
        await expect(memberRow(page, target).getByTestId('community-member-role'), 'the promotion survives a reload').toHaveText(
            /officer/i,
            { timeout: 15_000 },
        );

        const before = must(await hubEntry(admin, seed.gameId, seed.hubIds.crew), 'crew entry').memberCount;
        await memberAction(page, target, 'community-member-remove');
        await expect.poll(async () => (await hubEntry(admin, seed.gameId, seed.hubIds.crew))?.memberCount, {
            message: 'the removal must reach the API',
        }).toBe(before - 1);
        await page.reload();
        await expect(memberRow(page, target), 'the removed member is gone after a reload').toHaveCount(0, { timeout: 15_000 });
    });

    // ROK-1891: the leader's Overview checklist talks about a hub, never a WoW guild.
    test('Overview setup checklist has an invite step and no guild or raid wording', async ({ page }, testInfo) => {
        const seed = await seedHubs(testInfo);
        await signInOnboardedMember(page, seed.leaderUserId);
        await page.goto(`/hubs/${seed.hubIds.crew}`);
        const checklist = page.getByTestId('setup-checklist');
        await expect(checklist, 'the leader sees the setup checklist').toBeVisible({ timeout: 20_000 });
        await expect(checklist.getByTestId('setup-step-invite')).toContainText('Invite players to the hub');
        await expect(checklist, 'no WoW wording on a community hub checklist').not.toContainText(/guild|raid|roster/i);
    });

    test('settings: save the blurb, then Archive the hub', async ({ page }, testInfo) => {
        const seed = await seedHubs(testInfo);
        const admin = await getAdminToken();
        const blurb = `Smoke blurb ${testInfo.project.name} ${Date.now().toString(36)}`;
        await signInOnboardedMember(page, seed.leaderUserId);
        await page.goto(`/hubs/${seed.hubIds.crew}`);
        await page.getByTestId('guild-settings-trigger').click({ timeout: 20_000 });
        const sheet = page.getByTestId('guild-settings-sheet');
        await expect(sheet).toBeVisible();

        await sheet.getByLabel('Short description').fill(blurb);
        await sheet.getByRole('button', { name: 'Save description' }).click();
        await expect.poll(async () => (await hubEntry(admin, seed.gameId, seed.hubIds.crew))?.blurb, {
            message: 'the blurb must reach the API',
        }).toBe(blurb);

        await sheet.getByRole('button', { name: 'Archive hub' }).click();
        await sheet.getByTestId('community-archive-confirm').click();
        await expect.poll(async () => {
            const list = (await apiGet(admin, '/admin/hubs?status=archived')) as { items?: Array<{ id: number }> } | null;
            return (list?.items ?? []).map((h) => h.id);
        }, { message: 'the archive must reach the API' }).toContain(seed.hubIds.crew);
    });
});

/** Each rendered Hubs-card row's hub id — ROK-1883 AC3: no id twice. */
async function cardRowIds(card: Locator): Promise<string[]> {
    return card.getByTestId('game-hub-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-hub-id') ?? ''));
}

/** The `/hubs` directory card whose name link is exactly `name`. */
function directoryCard(page: Page, name: string): Locator {
    return page.getByTestId('hub-directory-card').filter({ has: page.getByRole('link', { name, exact: true }) });
}

test.describe('community hubs — admin', () => {
    test('one Hubs card lists every kind once; staff see the hidden server hub marked Hidden (ROK-1883)', async ({ page }, testInfo) => {
        const admin = await getAdminToken();
        await ensurePluginActive(admin, 'pelican');
        const seed = await seedHubs(testInfo);
        const body = (await apiGet(admin, `/hubs/by-game/${seed.gameId}`)) as { hubs?: Array<DirectoryEntry & { kind?: string; hidden?: boolean }> } | null;
        const hubs = must(body?.hubs, 'admin by-game hubs');
        const byId = (id: number): (DirectoryEntry & { kind?: string; hidden?: boolean }) | undefined => hubs.find((h) => h.id === id);
        expect(new Set(hubs.map((h) => h.id)).size, 'by-game lists each hub once').toBe(hubs.length);
        expect(byId(seed.hubIds.server), 'staff get the hidden server hub').toMatchObject({ kind: 'game_server', hidden: true });
        expect(byId(seed.hubIds.guild), 'staff get the WoW guild hub').toMatchObject({ kind: 'wow_guild', hidden: false });
        expect(byId(seed.hubIds.crew), 'the community hub is listed').toMatchObject({ kind: 'game_community', hidden: false });

        const card = await openGamePage(page, seed.gameId);
        const ids = await cardRowIds(card);
        expect(ids.length, 'the card renders rows').toBeGreaterThan(0);
        expect(new Set(ids).size, 'no hub renders twice on the game page').toBe(ids.length);
        await card.getByRole('link', { name: `See all ${hubs.length} hubs` }).click();
        await expect(page).toHaveURL(new RegExp(`/hubs\\?game=${seed.gameId}`));

        const kinds: Array<[string, string]> = [['Seed Server', 'Server'], ['Seed Guild', 'Guild'], ['Seed Crew', 'Community']];
        for (const [name, kind] of kinds) {
            const dirCard = directoryCard(page, name);
            await expect(dirCard, `${name} is listed once on /hubs`).toHaveCount(1, { timeout: 20_000 });
            await expect(dirCard.getByTestId('hub-kind-chip')).toHaveText(kind);
        }
        await expect(directoryCard(page, 'Seed Server').getByText('Hidden', { exact: true }), 'the hidden server hub is marked').toBeVisible();
        await expect(directoryCard(page, 'Seed Crew').getByText('Hidden', { exact: true }), 'a visible hub is not marked').toHaveCount(0);
    });

    test('ROK-1892: an admin proposal skips review and lands on the live hub', async ({ page }, testInfo) => {
        const seed = await seedHubs(testInfo);
        const admin = await getAdminToken();
        // Unique per project AND per run (D11); archived below so the game's card stays clean.
        const name = `Staff Hub ${testInfo.project.name} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const card = await openGamePage(page, seed.gameId);

        await card.getByRole('button', { name: 'Start a community hub' }).click();
        const dialog = page.getByRole('dialog', { name: 'Start a community hub' });
        await expect(dialog.getByText(/skips review and goes live right away/)).toBeVisible();
        await dialog.getByLabel('Hub name').fill(name);
        await dialog.getByLabel('Short description').fill('A staff smoke-test hub.');
        await page.getByRole('button', { name: 'Create hub' }).click();

        await expect(page, 'a staff proposer lands on the new hub').toHaveURL(/\/hubs\/\d+$/, { timeout: 20_000 });
        const hubId = Number(must(/\/hubs\/(\d+)$/.exec(page.url())?.[1], 'hub id in the URL'));
        try {
            await expect.poll(async () => (await hubEntry(admin, seed.gameId, hubId))?.name, {
                message: 'the hub is listed as active on its game',
            }).toBe(name);
            const queue = (await apiGet(admin, '/admin/hubs/proposals')) as { items?: Array<{ id: number }> } | null;
            expect((queue?.items ?? []).map((p) => p.id), 'no review-queue entry').not.toContain(hubId);
            await expect(page.getByRole('heading', { name, level: 1 }), 'the hub page renders').toBeVisible({ timeout: 15_000 });
        } finally {
            await apiPatch(admin, `/hubs/${hubId}/status`, { status: 'archived' }).catch(() => undefined);
        }
    });

    test('Admin → Hubs approves the seeded proposal; the proposer gets the notification', async ({ page }, testInfo) => {
        const seed = await seedHubs(testInfo);
        const admin = await getAdminToken();
        const queue = (await apiGet(admin, '/admin/hubs/proposals')) as {
            items?: Array<{ id: number; name: string; gameName: string; proposedBy: { userId: number } }>;
        } | null;
        const proposal = must(queue?.items?.find((p) => p.id === seed.proposalId), 'the seeded proposal in the queue');
        // The seed owns the name (it resets its own fixture per game), so read it
        // off the queue instead of hardcoding it.
        const hubName = proposal.name;
        expect(hubName, 'the seeded proposal has a name').not.toBe('');

        await page.goto(ADMIN_HUBS_PATH);
        // Exact-text scoping: a substring `hasText` on the game name can match a
        // parallel project's same-named proposal on a game whose name contains this one.
        const row = page
            .getByRole('listitem')
            .filter({ has: page.getByText(hubName, { exact: true }) })
            .filter({ has: page.getByText(proposal.gameName, { exact: true }) });
        await expect(row, 'the seeded proposal is in the Pending queue (exactly once)').toHaveCount(1, { timeout: 20_000 });
        await row.getByRole('button', { name: 'Approve', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: `Approve “${hubName}”` });
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: 'Approve hub' }).click();
        await expect(dialog, 'the dialog closes only on a successful approval').toBeHidden({ timeout: 20_000 });
        await pollForCondition(async () => {
            const list = (await apiGet(admin, '/admin/hubs/proposals')) as { items?: Array<{ id: number }> } | null;
            const ids = (list?.items ?? []).map((p) => p.id);
            return ids.includes(seed.proposalId) ? null : { ids };
        }, { timeoutMs: 30_000, description: `proposal ${seed.proposalId} leaves GET /admin/hubs/proposals` });

        const proposerJwt = await signInOnboardedMember(page, proposal.proposedBy.userId);
        await pollForCondition(async () => {
            const rows = ((await apiGet(proposerJwt, '/notifications?limit=50')) ?? []) as NotificationRow[];
            return rows.find((n) => n.type === 'hub_proposal_reviewed' && n.payload?.guildId === seed.proposalId) ?? null;
        }, { timeoutMs: 30_000, description: `hub_proposal_reviewed for hub ${seed.proposalId} reaches the proposer` });

        await page.goto('/calendar');
        await page.getByRole('button', { name: 'Notifications' }).first().click();
        await expect(page.getByText(`Your hub "${hubName}" is live`).first(), 'the bell lists the approval').toBeVisible({
            timeout: 15_000,
        });
    });
});
