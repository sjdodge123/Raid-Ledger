/**
 * ROK-2128 — Add character → "Guild roster" (WoW: Forever): a member claims an
 * unclaimed roster row in one click, the claimed row leaves the list, and an
 * admin moves the claimed character to another member with "Change owner".
 *
 * Fixture: `POST /admin/test/wow/seed-guild` (ROK-1785; a Forever guild by
 * default) with a per-project, per-worker, per-run name. Its `outsider` user has
 * no character (the claimer), `member` owns Dainel (the new owner), and
 * `unlinkedMemberIds` are the two owner-less rows (Corvin rank 2, Elowen rank 4).
 *
 * Roster names are fixed and a claim hides every same-named row of the game
 * (identity is game + region + name), so two projects claiming one name at once
 * would collide: desktop claims the first unlinked row, mobile the second.
 * Tablet is skipped — it renders the same phone layout mobile covers and there
 * is no third owner-less seed row; the fleet test plan covers tablet. The
 * claimed character is admin-unlinked (deleted) in `finally`, freeing the name.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, apiPost, getAdminToken } from './api-helpers';
import { signInAsAdmin, signInContextAs } from './browser-session';
import { isTablet } from './helpers';

const GAME_NAME = 'World of Warcraft: Forever';
const CLAIM_PATH = /\/plugins\/wow\/roster-claim\/members\/\d+\/claim$/;

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
    if (value === undefined || value === null) throw new Error(`[wow-roster-claim] missing ${label}`);
    return value;
}

function guildName(testInfo: TestInfo): string {
    return `Claim ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`;
}

async function seedGuild(token: string, testInfo: TestInfo): Promise<SeededGuild> {
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', { name: guildName(testInfo) })) as Partial<SeededGuild>;
    const ok = typeof body.guildId === 'number' && typeof body.gameId === 'number' && body.users && Array.isArray(body.unlinkedMemberIds);
    if (!ok || !body.users || !body.unlinkedMemberIds) throw new Error(`seed-guild: ${JSON.stringify(body)}`);
    return { guildId: must(body.guildId, 'guildId'), gameId: must(body.gameId, 'gameId'), name: must(body.name, 'name'), users: body.users, unlinkedMemberIds: body.unlinkedMemberIds };
}

/** The unclaimed candidates of one guild, as the API lists them now. */
async function guildCandidates(token: string, guild: SeededGuild): Promise<Candidate[]> {
    const body = (await apiGet(token, `/plugins/wow/roster-claim/candidates?gameId=${guild.gameId}`)) as { guilds?: CandidateGuild[] };
    return body.guilds?.find((g) => g.guildId === guild.guildId)?.candidates ?? [];
}

/** desktop → first owner-less row, mobile → second (see header). */
async function pickRow(token: string, guild: SeededGuild, testInfo: TestInfo): Promise<Candidate> {
    const memberId = must(guild.unlinkedMemberIds[testInfo.project.name === 'mobile' ? 1 : 0], 'unlinked member id');
    const row = (await guildCandidates(token, guild)).find((c) => c.memberId === memberId);
    return must(row, `candidate ${memberId} in guild ${guild.guildId}`);
}

const CANDIDATES_PATH = /\/plugins\/wow\/roster-claim\/candidates$/;

/** Open Add Character, pick WoW: Forever; returns the dialog and the candidate list the browser received. */
async function openForeverDialog(page: Page): Promise<{ dialog: Locator; listed: CandidateGuild[] }> {
    await page.goto('/profile/gaming/characters');
    await page.getByRole('button', { name: 'Add Character' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add Character' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    const game = dialog.getByRole('combobox', { name: 'Game', exact: true });
    const listed = page.waitForResponse((r) => r.request().method() === 'GET' && CANDIDATES_PATH.test(new URL(r.url()).pathname) && r.ok(), { timeout: 20_000 });
    await game.click();
    await game.pressSequentially(GAME_NAME, { delay: 20 });
    await page.getByRole('listbox').getByRole('option', { name: GAME_NAME, exact: true }).click();
    await expect(game).toHaveValue(GAME_NAME);
    const body = (await (await listed).json()) as { guilds?: CandidateGuild[] };
    return { dialog, listed: body.guilds ?? [] };
}

async function switchToRoster(dialog: Locator): Promise<void> {
    const toggle = dialog.getByRole('group', { name: 'Add character by' }).getByRole('button', { name: 'Guild roster' });
    await expect(toggle, 'Forever with an unclaimed roster row offers "Guild roster"').toBeVisible({ timeout: 15_000 });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
}

/** Click Claim on the row inside this guild's section; returns the created character id. */
async function claimInUi(page: Page, dialog: Locator, guild: SeededGuild, row: Candidate): Promise<string> {
    const section = dialog.locator('section').filter({ has: page.getByRole('heading', { name: guild.name, exact: true }) });
    const claim = section.getByRole('button', { name: `Claim ${row.name}`, exact: true });
    await expect(claim, 'the seeded unclaimed row is listed under its guild').toBeVisible({ timeout: 15_000 });
    const response = page.waitForResponse((r) => r.request().method() === 'POST' && CLAIM_PATH.test(new URL(r.url()).pathname), { timeout: 20_000 });
    await claim.click();
    const res = await response;
    const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
    expect(res.status(), `claim of member ${row.memberId}`).toBe(201);
    if (typeof body?.id !== 'string') throw new Error(`claim response has no character id: ${JSON.stringify(body)}`);
    return body.id;
}

/** Wait until the API reports `characterId` owned by `userId`. */
async function expectOwner(token: string, characterId: string, userId: number): Promise<void> {
    await expect
        .poll(async () => ((await apiGet(token, `/characters/${characterId}`)) as { userId?: unknown } | null)?.userId, {
            message: `character ${characterId} is owned by user ${userId}`,
            timeout: 15_000,
        })
        .toBe(userId);
}

async function changeOwnerInUi(page: Page, characterId: string, row: Candidate, target: SeedUser): Promise<void> {
    await page.goto(`/characters/${characterId}`);
    await page.getByRole('button', { name: 'Change owner' }).click();
    const modal = page.getByRole('dialog', { name: `Change owner of ${row.name}` });
    await expect(modal).toBeVisible({ timeout: 15_000 });
    const search = modal.getByPlaceholder('Search members');
    await search.click();
    await search.pressSequentially(target.username, { delay: 20 });
    await page.getByRole('option', { name: new RegExp(target.username) }).first().click();
    await modal.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(page.getByText(`${row.name} now belongs to ${target.username}.`)).toBeVisible({ timeout: 15_000 });
}

async function cleanup(token: string, guild: SeededGuild, characterId: string | null): Promise<void> {
    if (characterId) await apiPost(token, `/admin/plugins/wow/characters/${characterId}/unlink`, {}).catch(() => undefined);
    for (const user of Object.values(guild.users)) {
        await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
    }
}

test.describe('WoW: Forever — claim from the guild roster', () => {
    test('member claims a roster row in one click; it leaves the list; admin changes the owner', async ({ page }, testInfo) => {
        test.skip(isTablet(testInfo), 'desktop + phone only; two owner-less seed rows, the fleet test plan covers tablet');
        test.setTimeout(120_000);
        const token = await getAdminToken();
        const guild = await seedGuild(token, testInfo);
        let characterId: string | null = null;
        try {
            const row = await pickRow(token, guild, testInfo);
            await signInContextAs(page.context(), guild.users.outsider.userId);
            const { dialog } = await openForeverDialog(page);
            await switchToRoster(dialog);
            characterId = await claimInUi(page, dialog, guild, row);
            await expect(page.getByText(`${row.name} is now yours.`)).toBeVisible({ timeout: 15_000 });
            await expectOwner(token, characterId, guild.users.outsider.userId);
            await expect(page.getByText(row.name, { exact: true }).first(), 'the claimed character is on the profile').toBeVisible({ timeout: 15_000 });
            await expect.poll(async () => (await guildCandidates(token, guild)).some((c) => c.memberId === row.memberId), { timeout: 15_000 }).toBe(false);
            const reopened = await openForeverDialog(page);
            const relisted = reopened.listed.flatMap((g) => g.candidates).some((c) => c.memberId === row.memberId);
            expect(relisted, `claimed member ${row.memberId} is not in the list the browser receives`).toBe(false);
            await expect(reopened.dialog.getByRole('button', { name: `Claim ${row.name}`, exact: true }), 'a claimed row is never offered again').toHaveCount(0);
            await page.keyboard.press('Escape');
            await signInAsAdmin(page.context());
            await changeOwnerInUi(page, characterId, row, guild.users.member);
            await expectOwner(token, characterId, guild.users.member.userId);
        } finally {
            await cleanup(token, guild, characterId);
        }
    });
});
