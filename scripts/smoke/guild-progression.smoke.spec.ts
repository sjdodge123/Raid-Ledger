/**
 * ROK-1789 Part B — the WoW: Forever guild Progression tab (`#progression`):
 * per-instance boss sections + the 30-day guild activity feed, reached from the
 * Raid progress card's header "See all". Runs in every Playwright project; the
 * two-column layout (feed beside the instances) applies at ≥1024px only.
 *
 * Fixture: `POST /admin/test/wow/seed-guild` with `memberCount: 50` and
 * `withActivity: true` (implies pulls + dings) and a per-project, per-worker,
 * per-run name. The seed backdates the founding roster 400 days, re-stamps
 * fillers as 4 new members, a 12-row roster import, three single milestones
 * and one 4-member grouped milestone, adds ended guild events and Molten Core
 * (map 409) kills. Every UI assertion is checked against the route's own
 * payload, polled first (memory `feedback_smoke_polling_for_async_writes`), so
 * nothing depends on game names IGDB may rewrite or on the env's boss table.
 * Seeded users are deleted in `finally`.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import type { WowGuildActivityEntryDto, WowGuildProgressionPageDto } from '@raid-ledger/contract';
import { test, expect } from './base';
import { API_BASE, apiDelete, apiGet, apiPost, getAdminToken } from './api-helpers';
import { signInOnboardedMember } from './browser-session';
import { expectActiveHubTab, tabOrder } from './hub-tabs';

const FOREVER_SLUG = 'world-of-warcraft-forever';
const ANNIVERSARY_SLUG = 'world-of-warcraft-burning-crusade-classic-anniversary-edition';
const DESKTOP_MIN_WIDTH = 1024;
/** Mirrors the contract's GUILD_ACTIVITY_PAGE (rows before "Show all N"). */
const FEED_PAGE = 25;
/** Molten Core's Journal id: `RAID_MAP_INSTANCES[409]` → static name, never IGDB. */
const MC_KEY = 'j:741';
const EXPECTED_KINDS = ['first_kill', 'new_member', 'roster_import', 'event', 'ding', 'milestone'] as const;

type Role = 'gm' | 'officer' | 'member' | 'outsider';
type StampKind = 'new_member' | 'roster_import' | 'milestone' | 'grouped_milestone';

interface SeededGuild {
    guildId: number;
    users: Record<Role, { userId: number }>;
    stamped: Record<StampKind, number[]> | null;
}

const available: Record<string, boolean> = {};

/** Fail loudly on a missing value (strict flags: no `!`). */
function must<T>(value: T | undefined | null, label: string): T {
    if (value === undefined || value === null) throw new Error(`[guild-progression] missing ${label}`);
    return value;
}

function guildName(testInfo: TestInfo, tag: string): string {
    return `Progress ${tag} ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`;
}

type SeedBody = Partial<Omit<SeededGuild, 'stamped'>> & { activity?: { stamped?: Record<StampKind, number[]> } };

async function seedGuild(token: string, payload: Record<string, unknown>): Promise<SeededGuild> {
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', payload)) as SeedBody | null;
    if (typeof body?.guildId !== 'number' || !body.users) {
        throw new Error(`[guild-progression] seed-guild ${JSON.stringify(payload)}: ${JSON.stringify(body)}`);
    }
    return { guildId: body.guildId, users: body.users, stamped: body.activity?.stamped ?? null };
}

/** The Forever showcase: 50 members, full activity feed. */
async function seedForever(token: string, testInfo: TestInfo): Promise<SeededGuild> {
    const guild = await seedGuild(token, {
        name: guildName(testInfo, 'Forever'), gameSlug: FOREVER_SLUG, memberCount: 50, withActivity: true,
    });
    must(guild.stamped, 'seed-guild activity.stamped (withActivity: true)');
    return guild;
}

async function removeUsers(token: string, guild: SeededGuild): Promise<void> {
    for (const user of Object.values(guild.users)) {
        await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
    }
}

const progressionPath = (guildId: number): string => `/plugins/wow/guilds/${guildId}/progression`;

/** Polls the route until every seeded feed kind is present, then returns the payload. */
async function loadPage(jwt: string, guildId: number): Promise<WowGuildProgressionPageDto> {
    let last: WowGuildProgressionPageDto | null = null;
    await expect.poll(async () => {
        last = (await apiGet(jwt, progressionPath(guildId))) as WowGuildProgressionPageDto | null;
        return [...new Set((last?.activity.entries ?? []).map((e) => e.kind))].sort();
    }, { message: `GET ${progressionPath(guildId)} carries every seeded feed kind`, timeout: 20_000 })
        .toEqual([...EXPECTED_KINDS].sort());
    return must<WowGuildProgressionPageDto>(last, `GET ${progressionPath(guildId)}`);
}

const ofKind = <K extends WowGuildActivityEntryDto['kind']>(entries: WowGuildActivityEntryDto[], kind: K):
    Extract<WowGuildActivityEntryDto, { kind: K }>[] =>
    entries.filter((e): e is Extract<WowGuildActivityEntryDto, { kind: K }> => e.kind === kind);

const tab = (page: Page): Locator => page.getByTestId('wow-progression-tab');
const feedRows = (page: Page): Locator => page.getByTestId('guild-activity-feed').getByTestId('guild-activity-row');
const instanceSection = (page: Page, key: string): Locator =>
    tab(page).locator(`[data-testid="progression-instance"][data-instance-key="${key}"]`);

/** `data-kind` of every rendered feed row, in display order. */
async function renderedKinds(page: Page): Promise<string[]> {
    return feedRows(page).evaluateAll((rows) => rows.map((r) => r.getAttribute('data-kind') ?? '?'));
}

/** Overview → the Raid progress header "See all" → lands on the active Progression tab. */
async function openViaSeeAll(page: Page, testInfo: TestInfo, guildId: number): Promise<void> {
    await page.goto(`/hubs/${guildId}#overview`);
    await expect(page.getByTestId('guild-overview')).toBeVisible({ timeout: 15_000 });
    const seeAll = page.getByTestId('forever-see-all-progression');
    await expect(seeAll, 'the Raid progress card header carries "See all"').toBeVisible({ timeout: 20_000 });
    await expect(seeAll).toHaveAttribute('href', '#progression');
    await seeAll.click();
    await expect(page, '"See all" jumps to the Progression tab').toHaveURL(/#progression$/);
    await expectActiveHubTab(page, testInfo, 'Progression', 'progression');
    await expect(tab(page), 'the Progression tab body renders').toBeVisible({ timeout: 20_000 });
}

/** Each instance section matches the payload: name, "down/total" (or "/?"), boss rows. */
async function expectInstances(page: Page, data: WowGuildProgressionPageDto): Promise<void> {
    const { instances } = data.progression;
    const mc = must(instances.find((i) => i.key === MC_KEY), `${MC_KEY} (map 409) in the payload`);
    expect(mc.name, 'map 409 groups under its static name').toBe('Molten Core');
    expect(mc.bossesDown, 'the seeded Molten Core kills count as bosses down').toBeGreaterThan(0);
    await expect(tab(page).getByTestId('progression-instance'), 'one section per payload instance')
        .toHaveCount(instances.length, { timeout: 15_000 });
    for (const inst of instances) {
        const section = instanceSection(page, inst.key);
        await expect(section.locator('h3'), `${inst.key} heading`).toHaveText(inst.name);
        await expect(section.getByTestId('progression-instance-count'), `${inst.key} count`)
            .toHaveText(`${inst.bossesDown}/${inst.bossTotal ?? '?'}`);
        await expect(section.getByTestId('progression-boss-row'), `${inst.key} boss rows`).toHaveCount(inst.bosses.length);
    }
    if (instances.some((i) => i.key === 'other')) {
        expect(instances.at(-1)?.key, '"Other bosses" sorts last').toBe('other');
    }
}

/** Feed beside the instances at ≥1024px, below them under it. */
async function expectFeedPlacement(page: Page): Promise<void> {
    const left = must(await page.getByTestId('progression-instances').boundingBox(), 'instances box');
    const feed = must(await page.getByTestId('progression-feed').boundingBox(), 'feed box');
    const desktop = (page.viewportSize()?.width ?? 0) >= DESKTOP_MIN_WIDTH;
    if (desktop) expect(feed.x, 'desktop: the feed is the right-hand column').toBeGreaterThan(left.x + left.width - 1);
    else expect(feed.y, 'below 1024px: the feed stacks under the instances').toBeGreaterThanOrEqual(left.y + left.height - 1);
}

/** API-side feed facts: first-batch joins hidden, the import collapsed, the milestone grouped. */
function expectFeedPayload(entries: WowGuildActivityEntryDto[], stamped: Record<StampKind, number[]>): void {
    expect(ofKind(entries, 'new_member').length,
        'only the 4 re-stamped joins are new members — the 400-day founding batch is never listed')
        .toBe(stamped.new_member.length);
    const imports = ofKind(entries, 'roster_import');
    expect(imports.map((e) => e.count), 'the same-instant joins collapse into ONE roster-import row')
        .toEqual([stamped.roster_import.length]);
    const grouped = ofKind(entries, 'milestone').filter((e) => e.count > 1);
    expect(grouped.map((e) => e.count), 'the same-day 1-month milestones group into one row')
        .toEqual([stamped.grouped_milestone.length]);
    expect(ofKind(entries, 'first_kill').some((e) => e.instanceName === 'Molten Core'),
        'a Molten Core first kill is in the feed').toBe(true);
}

/** Rendered rows match the payload, then "Show all N" iff more than a page. */
async function expectFeedRows(page: Page, entries: WowGuildActivityEntryDto[]): Promise<void> {
    const kinds = entries.map((e) => e.kind);
    const toggle = page.getByTestId('guild-activity-feed').getByRole('button', { name: /^Show (all \d+|fewer)$/ });
    await expect.poll(() => renderedKinds(page), { message: 'the feed renders the first page, newest first', timeout: 15_000 })
        .toEqual(kinds.slice(0, FEED_PAGE));
    if (entries.length <= FEED_PAGE) {
        await expect(toggle, `${entries.length} rows fit one page: no "Show all"`).toHaveCount(0);
        return;
    }
    await expect(toggle).toHaveText(`Show all ${entries.length}`);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect.poll(() => renderedKinds(page), { message: '"Show all" expands to every row' }).toEqual(kinds);
    await expect(toggle).toHaveText('Show fewer');
    await toggle.click();
    await expect(feedRows(page), '"Show fewer" collapses back to one page').toHaveCount(FEED_PAGE);
}

/** Visible feed text for the collapsed / grouped rows (needs every row rendered). */
async function expectFeedText(page: Page, entries: WowGuildActivityEntryDto[], stamped: Record<StampKind, number[]>): Promise<void> {
    const shown = new Set(entries.slice(0, FEED_PAGE).map((e) => e.id));
    const visible = (e: WowGuildActivityEntryDto): boolean => shown.has(e.id);
    if (ofKind(entries, 'roster_import').some(visible)) {
        await expect(feedRows(page).filter({ hasText: `${stamped.roster_import.length} members added from a roster import` }),
            'the roster import reads as one count sentence').toHaveCount(1);
    }
    const others = stamped.grouped_milestone.length - 1;
    if (ofKind(entries, 'milestone').some((e) => e.count > 1 && visible(e))) {
        await expect(page.locator('[data-testid="guild-activity-row"][data-kind="milestone"]')
            .filter({ hasText: ` and ${others} other` }), 'the grouped milestone names its lead + N others').toHaveCount(1);
    }
}

test.describe('WoW: Forever guild Progression tab (ROK-1789 Part B)', () => {
    test.beforeAll(async () => {
        const admin = await getAdminToken();
        for (const slug of [FOREVER_SLUG, ANNIVERSARY_SLUG]) {
            const game = (await apiGet(admin, `/games/slug/${slug}`)) as { id?: number } | null;
            available[slug] = typeof game?.id === 'number';
        }
    });

    test.beforeEach(() => {
        test.skip(available[FOREVER_SLUG] !== true, `"${FOREVER_SLUG}" is not in this env (boot seed seed-games.data.ts did not run)`);
    });

    test('member: "See all" opens Progression — instance sections, boss rows and the activity feed', async ({ page }, testInfo) => {
        test.setTimeout(120_000);
        const admin = await getAdminToken();
        const guild = await seedForever(admin, testInfo);
        try {
            const stamped = must(guild.stamped, 'stamped');
            const jwt = await signInOnboardedMember(page, guild.users.member.userId);
            const data = await loadPage(jwt, guild.guildId);
            expectFeedPayload(data.activity.entries, stamped);

            await openViaSeeAll(page, testInfo, guild.guildId);
            expect(await tabOrder(page), 'a member has the Progression tab').toContain('progression');
            await expectInstances(page, data);
            await expectFeedPlacement(page);
            await expectFeedText(page, data.activity.entries, stamped);
            for (const kind of EXPECTED_KINDS) {
                const first = data.activity.entries.findIndex((e) => e.kind === kind);
                if (first < FEED_PAGE) {
                    await expect(page.locator(`[data-testid="guild-activity-row"][data-kind="${kind}"]`).first(),
                        `a "${kind}" row renders`).toBeVisible();
                }
            }
        } finally {
            await removeUsers(admin, guild);
        }
    });

    test('member: the feed shows 25 rows, and "Show all N" only when the seed produced more', async ({ page }, testInfo) => {
        test.setTimeout(120_000);
        const admin = await getAdminToken();
        const guild = await seedForever(admin, testInfo);
        try {
            const jwt = await signInOnboardedMember(page, guild.users.member.userId);
            const data = await loadPage(jwt, guild.guildId);
            await page.goto(`/hubs/${guild.guildId}#progression`);
            await expect(tab(page), 'the #progression deep link opens the tab').toBeVisible({ timeout: 20_000 });
            await expectFeedRows(page, data.activity.entries);
            expect(ofKind(data.activity.entries, 'new_member').length,
                'founding members never flood the feed').toBeLessThan(FEED_PAGE);
        } finally {
            await removeUsers(admin, guild);
        }
    });

    test('outsider: GET is 403, no Progression tab, #progression falls back to the join gate', async ({ page }, testInfo) => {
        const admin = await getAdminToken();
        const guild = await seedForever(admin, testInfo);
        try {
            const jwt = await signInOnboardedMember(page, guild.users.outsider.userId);
            const res = await fetch(`${API_BASE}${progressionPath(guild.guildId)}`, { headers: { Authorization: `Bearer ${jwt}` } });
            expect(res.status, 'a non-member cannot read the guild progression').toBe(403);
            await page.goto(`/hubs/${guild.guildId}#progression`);
            await expect(page.getByTestId('wow-join-gate'), 'a non-member sees the join gate').toBeVisible({ timeout: 20_000 });
            await expect(tab(page), 'no Progression body for a non-member').toHaveCount(0);
            expect(await tabOrder(page), 'no Progression tab for a non-member').not.toContain('progression');
        } finally {
            await removeUsers(admin, guild);
        }
    });

    test('Anniversary guild (Q-B15): a member has no Progression tab; #progression falls back to Overview', async ({ page }, testInfo) => {
        test.skip(available[ANNIVERSARY_SLUG] !== true, `"${ANNIVERSARY_SLUG}" is not in this env`);
        const admin = await getAdminToken();
        const guild = await seedGuild(admin, { name: guildName(testInfo, 'Anniv'), gameSlug: ANNIVERSARY_SLUG });
        try {
            await signInOnboardedMember(page, guild.users.member.userId);
            await page.goto(`/hubs/${guild.guildId}#progression`);
            await expect(page.getByTestId('guild-overview'), 'the deep link falls back to Overview').toBeVisible({ timeout: 20_000 });
            await expectActiveHubTab(page, testInfo, 'Overview', 'overview');
            await expect(tab(page), 'no Progression body on a non-Forever hub').toHaveCount(0);
            await expect(page.getByTestId('forever-see-all-progression'), 'no Forever "See all" on Anniversary').toHaveCount(0);
            expect(await tabOrder(page), 'Progression is Forever-only').not.toContain('progression');
        } finally {
            await removeUsers(admin, guild);
        }
    });
});
