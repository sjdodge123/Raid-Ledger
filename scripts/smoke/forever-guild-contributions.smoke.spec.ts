/**
 * ROK-2148 T26 / AC12 — the WoW: Forever hub "Guild contributions" card
 * (`blizzard` widget `forever-guild-contributions`, `contributions-card`):
 * profession masters from the Mailworthy guild template, the top givers of
 * guild-rule mail (30 days / All time segmented toggle) and who runs
 * Mailworthy. Runs on every Playwright project (desktop, mobile, tablet).
 *
 * Fixture: `POST /admin/test/wow/seed-guild` (ROK-1785) with a per-project,
 * per-worker, per-run name — a fresh realm-less Forever guild whose latest
 * roster is Aldren (GM, rank 0), Brisa (officer), Corvin (unlinked), Dainel
 * (`member`, rank 3) and Elowen (unlinked). The Mailworthy data arrives the
 * real way: the `member` imports a LedgerLink `char` export as Dainel, built
 * in-spec from the golden `char-mailworthy.txt` fixture with `who` re-pointed
 * at Dainel + the seeded guild and a `data.mailworthy` block whose timestamps
 * are relative to now (the golden one's fixed dates fall out of the 30-day
 * and 60-day windows as the calendar moves). Dainel's roster GUID is the
 * fixture's wire-shaped `Player-4395-<SHA1(lower(name))[0..7]><rank hex>`
 * (`seedRosterGuid`, `demo-test-guild.helpers.ts`) — a drift there fails the import on a
 * named assertion, not on a missing card.
 *
 *  T1 Member: after the import the card shows the Enchanting master, the
 *     30-day leader (Corvin, 30 items), "N members run Mailworthy"; All time
 *     re-ranks (Brisa, 90 items) and marks the viewer's own row "You".
 *  T2 Member of a guild with no Mailworthy data: every section's empty state,
 *     on both toggle positions.
 *  T3 Phone layout only: no horizontal overflow, the toggle segments are
 *     ≥44px tall and switch on tap.
 *
 * Every write is confirmed by polling the API (memory
 * `feedback_smoke_polling_for_async_writes`). Seeded users are deleted in
 * `finally`; the guild row stays, as in forever-guild-text.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, apiPost, getAdminToken } from './api-helpers';
import { signInOnboardedMember } from './browser-session';
import { isPhoneLayout } from './helpers';

const GAME_SLUG = 'world-of-warcraft-forever';
const HEADER = '!RL1!char!';
const DAY_S = 86_400;
const ENCHANTING = 333;
/** The seeded `member` role's roster row (`SEED_GUILD_ROSTER`). */
const EXPORTER = { name: 'Dainel', rank: 3 } as const;

type Role = 'gm' | 'officer' | 'member' | 'outsider';

interface SeededGuild {
    guildId: number;
    name: string;
    users: Record<Role, { userId: number; characterId: string | null }>;
}

interface Giver { rank: number; characterName: string; items: number; isYou: boolean }

interface Contributions {
    template: { authorName: string } | null;
    masters: { recipientName: string }[];
    givers: { last30Days: Giver[]; allTime: Giver[]; last30DaysTotal: number; allTimeTotal: number };
    users: { name: string }[];
}

let gameAvailable = false;

/** Fail loudly on a missing value (strict flags: no `!`). */
function must<T>(value: T | undefined | null, label: string): T {
    if (value === undefined || value === null) throw new Error(`[forever-guild-contributions] missing ${label}`);
    return value;
}

/** A guild name unique to this project, worker and run (fixture: 3-48 chars). */
function guildName(testInfo: TestInfo): string {
    return `Gcontrib ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`;
}

async function seedGuild(token: string, testInfo: TestInfo): Promise<SeededGuild> {
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', {
        name: guildName(testInfo),
        gameSlug: GAME_SLUG,
    })) as Partial<SeededGuild> | null;
    if (typeof body?.guildId !== 'number' || typeof body.name !== 'string' || !body.users) {
        throw new Error(`[forever-guild-contributions] seed-guild: ${JSON.stringify(body)}`);
    }
    return { guildId: body.guildId, name: body.name, users: body.users };
}

async function removeUsers(token: string, guild: SeededGuild): Promise<void> {
    for (const user of Object.values(guild.users)) {
        await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
    }
}

/** The seed fixture's roster GUID for `rank` (`demo-test-guild.helpers.ts` `guildKeyHash` + `seedRosterGuid`). */
function seededGuid(name: string, rank: number): string {
    const hash = createHash('sha1').update(name.toLowerCase()).digest('hex').slice(0, 12);
    return `Player-4395-${`${hash.slice(0, 7)}${rank.toString(16)}`.toUpperCase()}`;
}

/** The golden char wire payload (the `.txt`, not the decoder-output `.json`). */
function goldenCharPayload(): { who: Record<string, unknown>; data: Record<string, unknown> } & Record<string, unknown> {
    const file = path.resolve(process.cwd(), 'packages/contract/ledgerlink/v1/fixtures/char-mailworthy.txt');
    const token = readFileSync(file, 'utf8').trim();
    if (!token.startsWith(HEADER)) throw new Error(`char-mailworthy.txt should start with ${HEADER}`);
    return JSON.parse(inflateSync(Buffer.from(token.slice(HEADER.length), 'base64')).toString('utf8'));
}

/**
 * A Mailworthy block dated relative to now: Corvin leads the last 30 days,
 * Brisa leads all time, Dainel (the viewer) only gave 60 days ago.
 */
function mailworthyBlock(nowS: number): Record<string, unknown> {
    const today = Math.floor(nowS / DAY_S);
    const generatedAt = nowS - 120;
    const asOf = nowS - 180;
    const countingSince = nowS - 70 * DAY_S;
    const giver = (characterName: string, itemsAllTime: number, days: { day: number; items: number }[]) =>
        ({ characterName, itemsAllTime, countingSince, asOf, days });
    return {
        generatedAt,
        template: { rev: nowS - 3600, author: 'Aldren', rules: [{ professionSkillLineId: ENCHANTING, recipientName: 'Brisa' }] },
        peers: [
            { name: 'Aldren', lastSeenAt: nowS - 3600 },
            { name: 'Brisa', lastSeenAt: nowS - 7200 },
            { name: 'Corvin', lastSeenAt: nowS - 10_800 },
        ],
        givers: [
            giver('Brisa', 90, [{ day: today - 2, items: 12 }]),
            giver('Corvin', 40, [{ day: today - 5, items: 30 }]),
            giver(EXPORTER.name, 25, [{ day: today - 60, items: 25 }]),
        ],
    };
}

/** The golden export as Dainel of the seeded guild, carrying `mailworthyBlock`. */
function buildImportString(guild: SeededGuild): string {
    const golden = goldenCharPayload();
    const nowS = Math.floor(Date.now() / 1000);
    const fullName = EXPORTER.name;
    const who = {
        ...golden.who,
        guid: seededGuid(guild.name, EXPORTER.rank),
        fullName,
        raw: { getUnitName: fullName, unitName: [fullName, null] },
        guildName: guild.name,
    };
    const data = { ...golden.data, mailworthy: mailworthyBlock(nowS) };
    const payload = { ...golden, exportedAt: nowS - 60, who, data };
    return `${HEADER}${deflateSync(Buffer.from(JSON.stringify(payload), 'utf8')).toString('base64')}`;
}

const contribPath = (guildId: number): string => `/plugins/wow/guilds/${guildId}/contributions`;

async function contributionsOf(jwt: string, guildId: number): Promise<Contributions> {
    return must((await apiGet(jwt, contribPath(guildId))) as Contributions | null, `GET ${contribPath(guildId)}`);
}

/** Apply the export as the member through the character import route; the summary must say "applied". */
async function importAsMember(jwt: string, guild: SeededGuild): Promise<void> {
    const charId = must(guild.users.member.characterId, 'member characterId');
    const res = (await apiPost(jwt, `/plugins/wow/characters/${charId}/addon-import`, {
        importString: buildImportString(guild),
        dryRun: false,
    })) as { summary?: { mailworthy?: { status?: string } } } | null;
    expect(res?.summary?.mailworthy?.status, `char import with a Mailworthy block must apply: ${JSON.stringify(res)}`)
        .toBe('applied');
}

const card = (page: Page): Locator => page.getByTestId('contributions-card');
const segment = (page: Page, label: '30 days' | 'All time'): Locator =>
    card(page).getByTestId('contributions-givers').locator('label', { hasText: label });

async function openOverview(page: Page, guildId: number): Promise<void> {
    const loaded = page.waitForResponse(
        (r) => r.request().method() === 'GET' && new URL(r.url()).pathname.endsWith(contribPath(guildId)),
        { timeout: 20_000 },
    );
    await page.goto(`/hubs/${guildId}`);
    await expect(page.getByTestId('guild-overview')).toBeVisible({ timeout: 15_000 });
    expect((await loaded).status(), `GET ${contribPath(guildId)}`).toBe(200);
    await card(page).scrollIntoViewIfNeeded();
    await expect(card(page), 'a member sees the Guild contributions card').toBeVisible({ timeout: 15_000 });
}

/** Switch the givers period and confirm the radio took it. */
async function pickPeriod(page: Page, label: '30 days' | 'All time'): Promise<void> {
    await segment(page, label).click();
    await expect(card(page).getByRole('radio', { name: label }), `"${label}" is selected`).toBeChecked();
}

async function expectLeader(page: Page, name: string, items: number, message: string): Promise<void> {
    const first = card(page).getByTestId('contributions-giver-row').first();
    await expect(first, message).toContainText(name, { timeout: 10_000 });
    await expect(first.getByTestId('contributions-giver-items'), `${message} — count`).toHaveText(`${items} items`);
    await expect(first.getByTestId('contributions-rank'), `${message} — rank`).toHaveAttribute('data-rank', '1');
}

/** Sign the member in, import their Mailworthy export, and wait until the read shows it. */
async function importMailworthy(page: Page, guild: SeededGuild): Promise<Contributions> {
    const jwt = await signInOnboardedMember(page, guild.users.member.userId);
    await importAsMember(jwt, guild);
    await expect.poll(async () => {
        const c = await contributionsOf(jwt, guild.guildId);
        return {
            master: c.masters.map((m) => m.recipientName),
            leader30: c.givers.last30Days[0]?.characterName ?? null,
            leaderAll: c.givers.allTime[0]?.characterName ?? null,
        };
    }, { message: 'the import must reach the contributions read' })
        .toEqual({ master: ['Brisa'], leader30: 'Corvin', leaderAll: 'Brisa' });
    return contributionsOf(jwt, guild.guildId);
}

test.describe('WoW: Forever hub "Guild contributions" card (ROK-2148)', () => {
    test.beforeAll(async () => {
        const token = await getAdminToken();
        const game = (await apiGet(token, `/games/slug/${GAME_SLUG}`)) as { id?: number } | null;
        gameAvailable = typeof game?.id === 'number';
    });

    test.beforeEach(() => {
        test.skip(!gameAvailable, `"${GAME_SLUG}" is not in this env (boot seed seed-games.data.ts did not run)`);
    });

    test('T1 member: masters, ranked givers with the 30 days / All time toggle, and Mailworthy users after an import', async ({ page }, testInfo) => {
        const admin = await getAdminToken();
        const guild = await seedGuild(admin, testInfo);
        try {
            const data = await importMailworthy(page, guild);
            expect(data.givers.allTime.find((g) => g.characterName === EXPORTER.name)?.isYou,
                'the viewer\'s own all-time row is marked isYou').toBe(true);
            expect(data.users.length, `peers + exporter on the roster: ${JSON.stringify(data.users)}`).toBeGreaterThan(0);

            await openOverview(page, guild.guildId);
            const masters = card(page).getByTestId('contributions-master-row');
            await expect(masters, 'one profession master from the template').toHaveCount(1);
            await expect(masters.first(), 'the Enchanting master is Brisa').toContainText('Brisa');
            await expect(card(page).getByTestId('contributions-template'), 'the template names its author').toContainText('Aldren');

            await expect(card(page).getByRole('radio', { name: '30 days' }), '30 days is the default').toBeChecked();
            await expectLeader(page, 'Corvin', 30, '30 days: Corvin leads');
            await expect(card(page).getByTestId('contributions-givers-total').locator('b'), '30-day total')
                .toHaveText(String(data.givers.last30DaysTotal));

            await pickPeriod(page, 'All time');
            await expectLeader(page, 'Brisa', 90, 'All time: Brisa leads');
            await expect(card(page).getByTestId('contributions-giver-row'), 'all three givers rank all time')
                .toHaveCount(data.givers.allTime.length);
            await expect(card(page).getByTestId('contributions-giver-row').filter({ hasText: EXPORTER.name }),
                'the viewer\'s row is marked You').toContainText('You');
            await expect(card(page).getByTestId('contributions-givers-total').locator('b'), 'all-time total')
                .toHaveText(String(data.givers.allTimeTotal));

            await pickPeriod(page, '30 days');
            await expectLeader(page, 'Corvin', 30, 'back on 30 days: Corvin leads again');

            const n = data.users.length;
            await expect(card(page).getByTestId('contributions-users-count'), 'the Mailworthy users count')
                .toHaveText(`${n} ${n === 1 ? 'member runs' : 'members run'} Mailworthy`);
            await expect(card(page).getByTestId('contributions-user'), 'one chip per Mailworthy user').toHaveCount(n);
        } finally {
            await removeUsers(admin, guild);
        }
    });

    test('T2 member of a guild with no Mailworthy data: every section shows its empty state', async ({ page }, testInfo) => {
        const admin = await getAdminToken();
        const guild = await seedGuild(admin, testInfo);
        try {
            const jwt = await signInOnboardedMember(page, guild.users.member.userId);
            const empty = await contributionsOf(jwt, guild.guildId);
            expect({ template: empty.template, masters: empty.masters, last30: empty.givers.last30Days, all: empty.givers.allTime, users: empty.users },
                'a fresh guild has no Mailworthy data').toEqual({ template: null, masters: [], last30: [], all: [], users: [] });

            await openOverview(page, guild.guildId);
            await expect(card(page).getByTestId('contributions-masters-empty'), 'masters empty state').toBeVisible();
            await expect(card(page).getByTestId('contributions-givers-empty'), '30-day givers empty state')
                .toContainText('No guild-rule mail yet this month.');
            await expect(card(page).getByTestId('contributions-users-empty'), 'users empty state').toBeVisible();
            await expect(card(page).getByTestId('contributions-giver-row'), 'no giver rows').toHaveCount(0);

            await pickPeriod(page, 'All time');
            const allEmpty = card(page).getByTestId('contributions-givers-empty');
            await expect(allEmpty, 'all-time givers empty state').toContainText('No guild-rule mail yet.');
            await expect(allEmpty, 'the all-time copy drops "this month"').not.toContainText('this month');
        } finally {
            await removeUsers(admin, guild);
        }
    });

    test('T3 phone: the card fits the viewport and the toggle is a ≥44px tap target', async ({ page }, testInfo) => {
        test.skip(!isPhoneLayout(testInfo), 'Phone layout only — T1/T2 cover the card on every project');
        const admin = await getAdminToken();
        const guild = await seedGuild(admin, testInfo);
        try {
            await importMailworthy(page, guild);
            await openOverview(page, guild.guildId);

            const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
            expect(overflow, 'the hub page has no horizontal overflow').toBeLessThanOrEqual(0);
            const viewport = must(page.viewportSize(), 'viewport');
            const box = must(await card(page).boundingBox(), 'card bounding box');
            expect(box.x, 'the card starts inside the viewport').toBeGreaterThanOrEqual(0);
            expect(box.x + box.width, 'the card ends inside the viewport').toBeLessThanOrEqual(viewport.width);

            for (const label of ['30 days', 'All time'] as const) {
                const seg = must(await segment(page, label).boundingBox(), `"${label}" segment box`);
                expect(seg.height, `the "${label}" segment is at least 44px tall`).toBeGreaterThanOrEqual(44);
            }
            await segment(page, 'All time').tap();
            await expect(card(page).getByRole('radio', { name: 'All time' }), 'a tap selects All time').toBeChecked();
            await expectLeader(page, 'Brisa', 90, 'All time on a phone: Brisa leads');
        } finally {
            await removeUsers(admin, guild);
        }
    });
});
