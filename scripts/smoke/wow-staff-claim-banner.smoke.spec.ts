/**
 * ROK-2151 — a staff non-member on a claimable WoW: Forever guild hub sees a
 * "Claim your character" banner on the Overview (blizzard widget
 * `forever-claim-banner`, testid `wow-claim-banner`). Staff can open the page
 * without being a member, so they never meet the join gate; the banner opens
 * the gate's own Add character modal on this guild's roster.
 *
 * T1 — an operator outsider sees the banner; "Claim your character" opens Add
 *      character on the Guild roster tab narrowed to this guild; claiming a row
 *      hides the banner without a reload and the guild joins `GET /guilds/mine`.
 * T2 — × hides the banner and it stays hidden across a reload (sessionStorage
 *      `rl:wow-claim-banner-dismissed:<guildId>`).
 * T3 — a seeded member (not staff) never gets the banner and never fetches the
 *      join gate (D1).
 *
 * Fixture: `POST /admin/test/wow/seed-guild` (ROK-1785; Forever by default) per
 * test with a per-project, per-worker, per-run name AND a random `rosterSuffix`
 * (ROK-2132), so each seed owns its roster names. Its `outsider` has no
 * character; it is promoted to `operator` BEFORE sign-in, so the JWT it boots
 * with already carries the staff role. Desktop claims the first owner-less row
 * and mobile the second (as in wow-guild-join-gate); the claim test skips
 * tablet (two owner-less rows; the fleet test plan covers tablet). The claimed
 * character is admin-unlinked and the seeded users deleted in `finally`.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, apiPatch, apiPost, getAdminToken } from './api-helpers';
import { signInOnboardedMember } from './browser-session';
import { isTablet } from './helpers';

const CLAIM_PATH = /\/plugins\/wow\/roster-claim\/members\/\d+\/claim$/;
const CANDIDATES_PATH = /\/plugins\/wow\/roster-claim\/candidates$/;
const BANNER_LABEL = 'Claim your character';
const BANNER_LINE = "You're not a member of this guild yet — Claim your character to join.";
const dismissKey = (guildId: number): string => `rl:wow-claim-banner-dismissed:${guildId}`;

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
    if (value === undefined || value === null) throw new Error(`[wow-staff-claim-banner] missing ${label}`);
    return value;
}

function guildName(testInfo: TestInfo): string {
    return `Banner ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`;
}

/** Six random letters: this seed's roster names are its own (see header). */
function rosterSuffix(): string {
    return Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
}

async function seedGuild(token: string, testInfo: TestInfo): Promise<SeededGuild> {
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', { name: guildName(testInfo), rosterSuffix: rosterSuffix() })) as Partial<SeededGuild> | null;
    if (typeof body?.guildId !== 'number' || typeof body.gameId !== 'number' || !body.users || !Array.isArray(body.unlinkedMemberIds)) {
        throw new Error(`[wow-staff-claim-banner] seed-guild: ${JSON.stringify(body)}`);
    }
    return { guildId: body.guildId, gameId: body.gameId, name: must(body.name, 'name'), users: body.users, unlinkedMemberIds: body.unlinkedMemberIds };
}

async function cleanup(token: string, guild: SeededGuild, characterId: string | null): Promise<void> {
    if (characterId) await apiPost(token, `/admin/plugins/wow/characters/${characterId}/unlink`, {}).catch(() => undefined);
    for (const user of Object.values(guild.users)) {
        await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
    }
}

/** Staff BEFORE sign-in: the boot refresh then mints a JWT that already carries `operator`. */
async function makeOperator(token: string, user: SeedUser): Promise<void> {
    const body = (await apiPatch(token, `/users/${user.userId}/role`, { role: 'operator' })) as { data?: { role?: unknown } } | null;
    expect(body?.data?.role, `PATCH /users/${user.userId}/role promotes the outsider`).toBe('operator');
}

/** desktop → first owner-less row, mobile → second (see header). */
async function pickRow(token: string, guild: SeededGuild, testInfo: TestInfo): Promise<Candidate> {
    const memberId = must(guild.unlinkedMemberIds[testInfo.project.name === 'mobile' ? 1 : 0], 'unlinked member id');
    const body = (await apiGet(token, `/plugins/wow/roster-claim/candidates?gameId=${guild.gameId}`)) as { guilds?: CandidateGuild[] } | null;
    const row = body?.guilds?.find((g) => g.guildId === guild.guildId)?.candidates.find((c) => c.memberId === memberId);
    return must(row, `candidate ${memberId} in guild ${guild.guildId}`);
}

/** `GET /guilds/mine` as the viewer lists this guild (membership, not staff access). */
async function listsGuild(jwt: string, guildId: number): Promise<boolean> {
    const body = (await apiGet(jwt, '/guilds/mine')) as { guilds?: { id?: unknown }[] } | null;
    return body?.guilds?.some((g) => g.id === guildId) ?? false;
}

const banner = (page: Page): Locator => page.getByRole('region', { name: BANNER_LABEL, exact: true });

/** Signs the promoted outsider in and opens the hub: the page renders (staff), and the banner sits on it. */
async function openAsStaffOutsider(page: Page, token: string, guild: SeededGuild): Promise<string> {
    await makeOperator(token, guild.users.outsider);
    const jwt = await signInOnboardedMember(page, guild.users.outsider.userId);
    expect(await listsGuild(jwt, guild.guildId), 'the operator outsider starts as a non-member').toBe(false);
    await page.goto(`/hubs/${guild.guildId}`);
    await expect(page.getByTestId('guild-overview'), 'staff open the guild page, not the join gate').toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('wow-join-gate'), 'no join gate for staff').toHaveCount(0);
    await expect(banner(page), 'AC1: a staff non-member sees the claim banner').toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('wow-claim-banner')).toHaveCount(1);
    await expect(banner(page)).toContainText(BANNER_LINE);
    return jwt;
}

/** AC3 — the banner's button opens Add character on the Guild roster tab, narrowed to this guild. */
async function openClaimList(page: Page, guild: SeededGuild): Promise<Locator> {
    const listed = page.waitForRequest((r) => r.method() === 'GET' && CANDIDATES_PATH.test(new URL(r.url()).pathname)
        && new URL(r.url()).searchParams.get('guildId') === String(guild.guildId), { timeout: 20_000 });
    await banner(page).getByRole('button', { name: BANNER_LABEL, exact: true }).click();
    await listed;
    const dialog = page.getByRole('dialog', { name: 'Add Character' });
    await expect(dialog, 'Add character opens').toBeVisible({ timeout: 15_000 });
    const toggle = dialog.getByRole('group', { name: 'Add character by' }).getByRole('button', { name: 'Guild roster' });
    await expect(toggle, 'opens on the Guild roster tab').toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
    await expect(dialog.getByText(/^Showing/), 'the list is narrowed to this guild').toContainText(`Showing ${guild.name} only`, { timeout: 15_000 });
    return dialog;
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

test.describe('WoW: Forever — staff "Claim your character" banner (ROK-2151)', () => {
    test('T1: a staff non-member claims from the banner; the banner leaves and membership lands', async ({ page }, testInfo) => {
        test.skip(isTablet(testInfo), 'desktop + phone only; two owner-less seed rows, the fleet test plan covers tablet');
        test.setTimeout(120_000);
        const token = await getAdminToken();
        const guild = await seedGuild(token, testInfo);
        let characterId: string | null = null;
        try {
            const row = await pickRow(token, guild, testInfo);
            const jwt = await openAsStaffOutsider(page, token, guild);
            const dialog = await openClaimList(page, guild);
            characterId = await claimInUi(page, dialog, row);
            await expect(dialog, 'the modal closes after the claim').toBeHidden({ timeout: 15_000 });
            await expect(banner(page), 'AC4: the banner leaves once the claim confers membership, without a reload').toHaveCount(0, { timeout: 20_000 });
            await expect(page.getByTestId('wow-join-gate-warning'), 'AC5 warning stays away when membership landed').toHaveCount(0);
            await expect.poll(() => listsGuild(jwt, guild.guildId), { message: 'the claim makes the outsider a member (GET /guilds/mine lists the guild)', timeout: 15_000 }).toBe(true);
            await expect(page.getByTestId('guild-overview'), 'the page stays up under the claim').toBeVisible();
        } finally {
            await cleanup(token, guild, characterId);
        }
    });

    test('T2: × dismisses the banner, and it stays dismissed across a reload', async ({ page }, testInfo) => {
        test.setTimeout(90_000);
        const token = await getAdminToken();
        const guild = await seedGuild(token, testInfo);
        try {
            await openAsStaffOutsider(page, token, guild);
            await page.getByTestId('wow-claim-banner-dismiss').getByRole('button', { name: 'Dismiss', exact: true }).click();
            await expect(banner(page), 'AC6: × hides the banner').toHaveCount(0, { timeout: 10_000 });
            const stored = await page.evaluate((key) => window.sessionStorage.getItem(key), dismissKey(guild.guildId));
            expect(stored, 'the dismissal is kept for this guild in sessionStorage').toBe('1');
            // Staff read the gate whether or not the banner is dismissed (use-wow-claim-banner.ts), and that
            // read is what would show it: wait for it (registered BEFORE the reload) so the absence is not vacuous.
            const gateRead = page.waitForResponse((r) => r.request().method() === 'GET'
                && new URL(r.url()).pathname.endsWith(`/plugins/wow/guilds/${guild.guildId}/join-gate`), { timeout: 20_000 });
            await page.reload();
            expect((await gateRead).status(), 'the staff gate read still answers after the reload').toBe(200);
            await expect(page.getByTestId('guild-overview'), 'the page renders after the reload').toBeVisible({ timeout: 20_000 });
            // A later Overview card has committed, so the probe has had its render: the absence below is not a first-poll pass.
            await expect(page.getByRole('region', { name: 'Class breakdown', exact: true }), 'a core Forever card has rendered').toBeVisible({ timeout: 20_000 });
            await expect(banner(page), 'AC6: still dismissed after a reload').toHaveCount(0);
        } finally {
            await cleanup(token, guild, null);
        }
    });

    test('T3: a guild member (not staff) gets no banner and never reads the join gate', async ({ page }, testInfo) => {
        test.setTimeout(90_000);
        const token = await getAdminToken();
        const guild = await seedGuild(token, testInfo);
        try {
            await signInOnboardedMember(page, guild.users.member.userId);
            const gateReads: string[] = [];
            page.on('request', (r) => {
                if (new URL(r.url()).pathname.endsWith(`/plugins/wow/guilds/${guild.guildId}/join-gate`)) gateReads.push(r.url());
            });
            await page.goto(`/hubs/${guild.guildId}`);
            await expect(page.getByTestId('guild-overview')).toBeVisible({ timeout: 20_000 });
            await expect(page.getByRole('region', { name: 'Class breakdown', exact: true }), 'a core Forever card has rendered').toBeVisible({ timeout: 20_000 });
            await expect(page.getByTestId('wow-claim-banner'), 'AC2: no banner for a non-staff member').toHaveCount(0);
            expect(gateReads, 'D1: a non-staff member never fetches the join gate').toEqual([]);
        } finally {
            await cleanup(token, guild, null);
        }
    });
});
