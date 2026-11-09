/**
 * ROK-2132 — WoW: Forever guild join gate. A signed-in non-member opening a
 * Forever guild hub sees the gate (`wow-join-gate`) instead of the guild page;
 * "Pick my character" opens Add character on the Guild roster tab narrowed to
 * this guild; claiming a roster row confers membership and lands on the page;
 * the `/hubs` directory card says "Claim your character to join" and lands on
 * `/hubs/<id>?claim=roster` with the filtered list open; a signed-out visitor
 * is sent to sign in, and the requested hub is saved for after sign-in
 * (ACs 1, 2, 4, 5, 12).
 *
 * Fixture: `POST /admin/test/wow/seed-guild` (ROK-1785; Forever by default)
 * with a per-project, per-worker, per-run name. Its `outsider` user has no
 * character (the non-member), and `unlinkedMemberIds` are the two owner-less
 * roster rows (Corvin, Elowen + a per-run `rosterSuffix`). Seeded rows are `addon_import` rows carrying a
 * roster GUID, and a claim writes that GUID as the character's `addon_guid`,
 * so the claim confers membership on main without ROK-2115 (which covers the
 * GUID-less `source='blizzard'` rows).
 *
 * A claim hides every same-named row of the game (identity is game + region +
 * name), so each seed gets its own random `rosterSuffix`: a concurrent spec
 * (wow-roster-claim claims the unsuffixed Corvin/Elowen) never shares a name.
 * Desktop still claims the first owner-less row and mobile the second; the
 * claim test skips tablet (the fleet test plan covers tablet).
 * The claimed character is admin-unlinked and the seeded users deleted in
 * `finally`; the guild row stays, as in wow-roster-claim.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, apiPost, getAdminToken } from './api-helpers';
import { signInOnboardedMember } from './browser-session';
import { isPhoneLayout, isTablet } from './helpers';

const CLAIM_PATH = /\/plugins\/wow\/roster-claim\/members\/\d+\/claim$/;
const CANDIDATES_PATH = /\/plugins\/wow\/roster-claim\/candidates$/;
const JOIN_LINE = 'This guild page is for members. Find your character on the roster to join.';
const CLAIM_LABEL = 'Claim your character to join';
const CLAIM_SHORT = 'Claim to join';
/** `SEED_GUILD_ROSTER.length` (demo-test-guild.helpers.ts). */
const SEED_ROSTER_SIZE = 5;

interface SeedUser { userId: number; username: string }
interface SeededGuild {
    guildId: number;
    gameId: number;
    name: string;
    users: Record<'outsider' | 'member' | 'gm' | 'officer', SeedUser>;
    unlinkedMemberIds: number[];
}
interface Candidate { memberId: number; name: string }
interface CandidateGuild { guildId: number; candidates: Candidate[] }

function must<T>(value: T | undefined | null, label: string): T {
    if (value === undefined || value === null) throw new Error(`[wow-guild-join-gate] missing ${label}`);
    return value;
}

function guildName(testInfo: TestInfo): string {
    return `Gate ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`;
}

/** Six random letters: this seed's roster names are its own (see header). */
function rosterSuffix(): string {
    return Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
}

async function seedGuild(token: string, testInfo: TestInfo): Promise<SeededGuild> {
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', { name: guildName(testInfo), rosterSuffix: rosterSuffix() })) as Partial<SeededGuild> | null;
    if (typeof body?.guildId !== 'number' || typeof body.gameId !== 'number' || !body.users || !Array.isArray(body.unlinkedMemberIds)) {
        throw new Error(`[wow-guild-join-gate] seed-guild: ${JSON.stringify(body)}`);
    }
    return { guildId: body.guildId, gameId: body.gameId, name: must(body.name, 'name'), users: body.users, unlinkedMemberIds: body.unlinkedMemberIds };
}

async function cleanup(token: string, guild: SeededGuild, characterId: string | null): Promise<void> {
    if (characterId) await apiPost(token, `/admin/plugins/wow/characters/${characterId}/unlink`, {}).catch(() => undefined);
    for (const user of Object.values(guild.users)) {
        await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
    }
}

/** desktop → first owner-less row, mobile → second (see header). */
async function pickRow(token: string, guild: SeededGuild, testInfo: TestInfo): Promise<Candidate> {
    const memberId = must(guild.unlinkedMemberIds[testInfo.project.name === 'mobile' ? 1 : 0], 'unlinked member id');
    const body = (await apiGet(token, `/plugins/wow/roster-claim/candidates?gameId=${guild.gameId}`)) as { guilds?: CandidateGuild[] } | null;
    const row = body?.guilds?.find((g) => g.guildId === guild.guildId)?.candidates.find((c) => c.memberId === memberId);
    return must(row, `candidate ${memberId} in guild ${guild.guildId}`);
}

/** `GET /guilds/:id` as the viewer: 200 → true; `apiGet` returns null on the 403. */
async function canReadGuildPage(jwt: string, guildId: number): Promise<boolean> {
    return (await apiGet(jwt, `/guilds/${guildId}`)) !== null;
}

const gate = (page: Page): Locator => page.getByTestId('wow-join-gate');

/** AC 1 — the gate's facts, and no guild page behind it. */
async function expectGate(page: Page, guild: SeededGuild): Promise<void> {
    await expect(gate(page), 'a non-member sees the join gate').toBeVisible({ timeout: 20_000 });
    await expect(gate(page).getByRole('heading', { name: guild.name, level: 1 })).toBeVisible();
    await expect(gate(page)).toContainText('WoW: Forever');
    await expect(gate(page)).toContainText(`${SEED_ROSTER_SIZE} members`);
    await expect(gate(page)).toContainText(JOIN_LINE);
    await expect(gate(page).getByRole('button', { name: 'Pick my character', exact: true })).toBeVisible();
    await expect(gate(page).getByRole('button', { name: 'Import from Armory', exact: true })).toBeVisible();
    await expect(page.getByTestId('guild-overview'), 'no guild page renders behind the gate').toHaveCount(0);
    await expect(page.getByTestId('wow-join-gate-hint'), 'no Forever character → no not-on-roster hint').toHaveCount(0);
}

/** AC 2 / 12 — Add character on the Guild roster tab, narrowed to this guild (request carries `guildId`). */
async function expectFilteredRoster(page: Page, guild: SeededGuild): Promise<Locator> {
    const dialog = page.getByRole('dialog', { name: 'Add Character' });
    await expect(dialog, 'Add character opens').toBeVisible({ timeout: 15_000 });
    const toggle = dialog.getByRole('group', { name: 'Add character by' }).getByRole('button', { name: 'Guild roster' });
    await expect(toggle, 'opens on the Guild roster tab').toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
    await expect(dialog.getByText(/^Showing/), 'the list is narrowed to this guild').toContainText(`Showing ${guild.name} only`, { timeout: 15_000 });
    return dialog;
}

/** Opens the gate's "Pick my character" and checks the candidates request names this guild. */
async function pickMyCharacter(page: Page, guild: SeededGuild): Promise<Locator> {
    const listed = page.waitForRequest((r) => r.method() === 'GET' && CANDIDATES_PATH.test(new URL(r.url()).pathname)
        && new URL(r.url()).searchParams.get('guildId') === String(guild.guildId), { timeout: 20_000 });
    await gate(page).getByRole('button', { name: 'Pick my character', exact: true }).click();
    await listed;
    return expectFilteredRoster(page, guild);
}

async function claimInUi(page: Page, dialog: Locator, row: Candidate): Promise<string> {
    const claim = dialog.getByRole('button', { name: `Claim ${row.name}`, exact: true });
    await expect(claim, 'the seeded unclaimed row is offered').toBeVisible({ timeout: 15_000 });
    const response = page.waitForResponse((r) => r.request().method() === 'POST' && CLAIM_PATH.test(new URL(r.url()).pathname), { timeout: 20_000 });
    await claim.click();
    const res = await response;
    const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
    expect(res.status(), `claim of member ${row.memberId}`).toBe(201);
    if (typeof body?.id !== 'string') throw new Error(`claim response has no character id: ${JSON.stringify(body)}`);
    return body.id;
}

test.describe('WoW: Forever — guild join gate (ROK-2132)', () => {
    test('non-member sees the gate; Pick my character lists only this guild; Show all widens it', async ({ page }, testInfo) => {
        test.setTimeout(90_000);
        const token = await getAdminToken();
        const guild = await seedGuild(token, testInfo);
        try {
            await signInOnboardedMember(page, guild.users.outsider.userId);
            await page.goto(`/hubs/${guild.guildId}`);
            await expectGate(page, guild);
            const dialog = await pickMyCharacter(page, guild);
            await dialog.getByRole('button', { name: 'Show all guilds', exact: true }).click();
            await expect(dialog.getByText(/^Showing .+ only/), '"Show all guilds" clears the one-guild filter').toHaveCount(0, { timeout: 15_000 });
        } finally {
            await cleanup(token, guild, null);
        }
    });

    test('claiming a roster row from the gate lands on the guild page', async ({ page }, testInfo) => {
        test.skip(isTablet(testInfo), 'desktop + phone only; two owner-less seed rows, the fleet test plan covers tablet');
        test.setTimeout(120_000);
        const token = await getAdminToken();
        const guild = await seedGuild(token, testInfo);
        let characterId: string | null = null;
        try {
            const row = await pickRow(token, guild, testInfo);
            const jwt = await signInOnboardedMember(page, guild.users.outsider.userId);
            expect(await canReadGuildPage(jwt, guild.guildId), 'the outsider starts as a non-member (403)').toBe(false);
            await page.goto(`/hubs/${guild.guildId}`);
            await expectGate(page, guild);
            const dialog = await pickMyCharacter(page, guild);
            characterId = await claimInUi(page, dialog, row);
            await expect(dialog, 'the modal closes after the claim').toBeHidden({ timeout: 15_000 });
            // The seeded row carries a roster GUID, so the claim confers membership without ROK-2115.
            await expect.poll(() => canReadGuildPage(jwt, guild.guildId), { message: 'the claim makes the outsider a member (GET /guilds/:id → 200)', timeout: 15_000 }).toBe(true);
            await expect(page.getByTestId('guild-overview'), 'AC 4: the guild page renders without a reload').toBeVisible({ timeout: 20_000 });
            await expect(gate(page)).toHaveCount(0);
            await expect(page.getByTestId('wow-join-gate-warning'), 'AC 8 banner stays away when membership landed').toHaveCount(0);
        } finally {
            await cleanup(token, guild, characterId);
        }
    });

    test('/hubs directory: the card says Claim your character to join and lands on the filtered list', async ({ page }, testInfo) => {
        test.setTimeout(90_000);
        const token = await getAdminToken();
        const guild = await seedGuild(token, testInfo);
        try {
            await signInOnboardedMember(page, guild.users.outsider.userId);
            await page.goto(`/hubs?game=${guild.gameId}&q=${encodeURIComponent(guild.name)}`);
            await expect(page.getByRole('heading', { name: 'Hubs', level: 1 })).toBeVisible({ timeout: 20_000 });
            const card = page.getByTestId('hub-directory-card').filter({ hasText: guild.name });
            await expect(card, 'the non-member sees the claimable Forever guild').toHaveCount(1, { timeout: 15_000 });
            const link = card.getByRole('link', { name: `${CLAIM_LABEL}: ${guild.name}`, exact: true });
            await expect(link).toBeVisible();
            await expect(link).toHaveText(isPhoneLayout(testInfo) ? CLAIM_SHORT : CLAIM_LABEL);
            await expect(card.getByRole('link', { name: 'View', exact: true }), 'a non-member gets the claim action, not View').toHaveCount(0);
            await link.click();
            await expect(page).toHaveURL(new RegExp(`/hubs/${guild.guildId}(\\?claim=roster)?$`), { timeout: 15_000 });
            await expect(gate(page)).toBeVisible({ timeout: 20_000 });
            await expectFilteredRoster(page, guild);
            await expect(page, '?claim=roster opens once, then leaves the URL').toHaveURL(new RegExp(`/hubs/${guild.guildId}$`), { timeout: 15_000 });
        } finally {
            await cleanup(token, guild, null);
        }
    });

    test('signed out: /hubs/<id> asks to sign in, then returns to the gate', async ({ browser }, testInfo) => {
        test.setTimeout(90_000);
        const token = await getAdminToken();
        const guild = await seedGuild(token, testInfo);
        const target = `/hubs/${guild.guildId}`;
        const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
        try {
            const page = await context.newPage();
            await page.goto(target);
            await expect(page, 'AuthGuard sends a signed-out visitor to the sign-in page').toHaveURL((url) => url.pathname === '/', { timeout: 20_000 });
            await expect(page.getByRole('button', { name: /sign in|continue with/i }).first()).toBeVisible({ timeout: 20_000 });
            await expect(gate(page)).toHaveCount(0);
            const saved = await page.evaluate(() => window.sessionStorage.getItem('authRedirect'));
            expect(saved, 'AuthGuard keeps the requested hub for after sign-in').toBe(target);
            // The outsider has no password, so a magic link minted with `path: target` signs in. Landing on the
            // hub proves the link honours `path`, not that the saved redirect is consumed (unit-tested elsewhere).
            const res = (await apiPost(token, '/admin/test/sign-in-link', { userId: guild.users.outsider.userId, path: target })) as { url?: unknown } | null;
            if (typeof res?.url !== 'string') throw new Error('sign-in-link minted no url');
            const link = new URL(res.url);
            await page.goto(`${link.pathname}${link.search}${link.hash}`);
            await expect(page).toHaveURL(new RegExp(`${target}$`), { timeout: 20_000 });
            await expectGate(page, guild);
        } finally {
            await context.close();
            await cleanup(token, guild, null);
        }
    });
});
