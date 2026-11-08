/**
 * ROK-2136 — the WoW: Forever hub "Guild message" card (`blizzard` widget
 * `forever-guild-text`, cell `#hub-widget-blizzard-forever-guild-text`):
 * the guild Message of the Day + Guild Information, each with
 * "Copy for in-game". Runs on every Playwright project (desktop, mobile,
 * tablet) — the editor is a `Modal` at ≥1024px and a `BottomSheet` below.
 *
 * Fixture: `POST /admin/test/wow/seed-guild` (ROK-1785) with a per-project,
 * per-worker, per-run name — a fresh Forever guild, so its in-game text starts
 * empty. Its officer (rank 1) holds the seeded delegated-editor rank grant, so
 * the officer is the editor; the plain `member` is the non-editor. Every test
 * re-checks `viewer.canEdit` through the API first, so a fixture drift fails on
 * a named assertion instead of a missing button.
 *
 *  T1 Editor: "Add guild text" → MOTD (with a line break) + Info → Save → the
 *     card shows both verbatim with the "Updated … by …" line; each
 *     "Copy for in-game" copies the exact stored string.
 *  T2 Member: text saved through the API → the card shows it, "Copy for
 *     in-game" copies it exactly, and there is no Edit / Add control.
 *  T3 Editor: the 255 / 499 caps hold with the shared `n/max` counter; `|`
 *     warns without blocking; a control character blocks Save; a dirty Cancel
 *     asks to discard and nothing is saved.
 *  T4 Editor (ROK-2137): an in-game report seeded through
 *     `POST /admin/test/wow/seed-guild-game-text` raises "Changed in game";
 *     "Use in-game text" makes it the hub text, and after a reseed of the
 *     other field "Keep hub text" clears the notice, keeps the hub text and
 *     shows the Copy-for-in-game hint.
 *
 * The clipboard is a recording stub (headless clipboards vary by project —
 * valheim-link-token precedent): it records exactly what `copyWithToast`
 * hands `navigator.clipboard.writeText`, in `<html data-guild-text-copied>`.
 * Every write is confirmed by polling the API (memory
 * `feedback_smoke_polling_for_async_writes`). Seeded users are deleted in
 * `finally`; the guild row stays, as in forever-hub-widgets.
 */
import type { Locator, Page, Response, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, apiPost, apiPut, getAdminToken } from './api-helpers';
import { signInOnboardedMember } from './browser-session';

const GAME_SLUG = 'world-of-warcraft-forever';
const MOTD_MAX = 255;
const INFO_MAX = 499;
const MOTD = 'Raid tonight at 8 server time\nBring flasks and repair';
const INFO = 'Loot: council for Molten Core.\nBe kind in guild chat.\n  Indented line kept.';
const COPY_LABEL = 'Copy for in-game';
const CONTROL_CHAR_COPY = 'Remove tabs and other invisible characters';
const COPIED_ATTR = 'guildTextCopied';
const GAME_MOTD = 'Raid moved to Thursday 8 server time';
const GAME_INFO = 'Loot: open roll for Onyxia.\nNew officers: ask in guild chat.';
const KEPT_HINT = 'Hub text kept — use Copy for in-game to put it back in the game.';

type Role = 'gm' | 'officer' | 'member' | 'outsider';

interface SeededGuild {
    guildId: number;
    users: Record<Role, { userId: number }>;
}

interface IngameField { text: string; updatedAt: string; updatedBy: string | null }

interface GameReport { gameText: string; gameReportedAt: string; changedInGame: boolean }

interface IngameText {
    motd: IngameField | null;
    info: IngameField | null;
    viewer: { canEdit: boolean };
    /** ROK-2137 — editors only. */
    game?: { motd: GameReport | null; info: GameReport | null };
}

type Field = 'motd' | 'info';

let gameAvailable = false;

/** Fail loudly on a missing value (strict flags: no `!`). */
function must<T>(value: T | undefined | null, label: string): T {
    if (value === undefined || value === null) throw new Error(`[forever-guild-text] missing ${label}`);
    return value;
}

/** A guild name unique to this project, worker and run (fixture: 3-48 chars). */
function guildName(testInfo: TestInfo): string {
    return `Gtext ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`;
}

async function seedGuild(token: string, testInfo: TestInfo): Promise<SeededGuild> {
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', {
        name: guildName(testInfo),
        gameSlug: GAME_SLUG,
    })) as Partial<SeededGuild> | null;
    if (typeof body?.guildId !== 'number' || !body.users) {
        throw new Error(`[forever-guild-text] seed-guild: ${JSON.stringify(body)}`);
    }
    return { guildId: body.guildId, users: body.users };
}

async function removeUsers(token: string, guild: SeededGuild): Promise<void> {
    for (const user of Object.values(guild.users)) {
        await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
    }
}

const textPath = (guildId: number): string => `/plugins/wow/guilds/${guildId}/ingame-text`;

async function textOf(jwt: string, guildId: number): Promise<IngameText> {
    return must((await apiGet(jwt, textPath(guildId))) as IngameText | null, `GET ${textPath(guildId)}`);
}

/** Records what the app writes to the clipboard — exactly the string handed to `writeText`. */
async function installCopyRecorder(page: Page): Promise<void> {
    await page.addInitScript((attr: string) => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: async (text: string): Promise<void> => {
                    document.documentElement.dataset[attr] = text;
                },
            },
        });
    }, COPIED_ATTR);
}

async function copiedText(page: Page): Promise<string | null> {
    return page.evaluate((attr: string) => document.documentElement.dataset[attr] ?? null, COPIED_ATTR);
}

const card = (page: Page): Locator => page.locator('#hub-widget-blizzard-forever-guild-text');
const block = (page: Page, field: 'motd' | 'info'): Locator => card(page).getByTestId(`guild-text-${field}`);

async function openOverview(page: Page, guildId: number): Promise<void> {
    const loaded = page.waitForResponse(
        (r) => r.request().method() === 'GET' && new URL(r.url()).pathname.endsWith(textPath(guildId)),
        { timeout: 20_000 },
    );
    await page.goto(`/hubs/${guildId}`);
    await expect(page.getByTestId('guild-overview')).toBeVisible({ timeout: 15_000 });
    expect((await loaded).status(), `GET ${textPath(guildId)}`).toBe(200);
}

function textWrite(page: Page, guildId: number): Promise<Response> {
    return page.waitForResponse(
        (r) => r.request().method() === 'PUT' && new URL(r.url()).pathname.endsWith(textPath(guildId)),
        { timeout: 20_000 },
    );
}

/** The empty card's "Add guild text" opens the editor; returns the MOTD textarea once it shows. */
async function openEditorFromHint(page: Page): Promise<Locator> {
    const hint = card(page).getByTestId('guild-text-hint');
    await expect(hint, 'an editor sees the empty card\'s hint').toBeVisible({ timeout: 15_000 });
    await hint.getByTestId('guild-text-add').click();
    const motd = page.getByTestId('guild-text-input-motd');
    await expect(motd, 'the Guild message editor opens').toBeVisible({ timeout: 15_000 });
    return motd;
}

/** Sets a textarea's value as React sees an input event — `fill` may drop control characters. */
async function setRawValue(input: Locator, value: string): Promise<void> {
    await input.evaluate((el: HTMLTextAreaElement, v: string) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (!setter) throw new Error('no HTMLTextAreaElement value setter');
        setter.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
}

/** The card shows `expected` byte for byte (toHaveText alone collapses whitespace). */
async function expectExactText(locator: Locator, expected: string, label: string): Promise<void> {
    await expect(locator, label).toHaveText(expected, { timeout: 15_000 });
    expect(await locator.textContent(), `${label} — exact, line breaks included`).toBe(expected);
}

/** ROK-2137 fixture: store an in-game report (as a LedgerLink export would) and clear its Push ack. */
async function seedGameText(token: string, guildId: number, text: Partial<Record<Field, string>>): Promise<void> {
    const body = (await apiPost(token, '/admin/test/wow/seed-guild-game-text', { guildId, ...text })) as
        { guildId?: number } | null;
    if (body?.guildId !== guildId) throw new Error(`[forever-guild-text] seed-guild-game-text: ${JSON.stringify(body)}`);
}

/** Polls the editor's view of one field: hub text + the game block's changedInGame. */
async function expectFieldState(jwt: string, guildId: number, field: Field, want: { text: string; changed: boolean }, message: string): Promise<void> {
    await expect.poll(async () => {
        const t = await textOf(jwt, guildId);
        return { text: t[field]?.text ?? null, changed: t.game?.[field]?.changedInGame ?? null };
    }, { message }).toEqual(want);
}

function gameAction(page: Page, guildId: number, field: Field, action: 'adopt' | 'push'): Promise<Response> {
    return page.waitForResponse(
        (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith(`${textPath(guildId)}/${field}/${action}`),
        { timeout: 20_000 },
    );
}

async function copyAndRead(page: Page, field: 'motd' | 'info', expected: string): Promise<void> {
    await block(page, field).getByRole('button', { name: COPY_LABEL }).click();
    await expect.poll(() => copiedText(page), {
        message: `"Copy for in-game" on ${field} must hand the clipboard exactly the stored text`,
    }).toBe(expected);
}

test.describe('WoW: Forever hub "Guild message" card (ROK-2136)', () => {
    test.beforeAll(async () => {
        const token = await getAdminToken();
        const game = (await apiGet(token, `/games/slug/${GAME_SLUG}`)) as { id?: number } | null;
        gameAvailable = typeof game?.id === 'number';
    });

    test.beforeEach(() => {
        test.skip(!gameAvailable, `"${GAME_SLUG}" is not in this env (boot seed seed-games.data.ts did not run)`);
    });

    test('T1 editor: Add guild text → MOTD + Info → Save → the card shows both; Copy for in-game copies them exactly', async ({ page }, testInfo) => {
        const admin = await getAdminToken();
        const guild = await seedGuild(admin, testInfo);
        try {
            await installCopyRecorder(page);
            const jwt = await signInOnboardedMember(page, guild.users.officer.userId);
            const before = await textOf(jwt, guild.guildId);
            expect(before, 'a fresh guild has no in-game text, no in-game report (ROK-2137 editor-only game block), and the officer (delegated editor rank) can edit')
                .toEqual({ guildId: guild.guildId, motd: null, info: null, viewer: { canEdit: true }, game: { motd: null, info: null } });

            await openOverview(page, guild.guildId);
            const motdInput = await openEditorFromHint(page);
            await motdInput.fill(MOTD);
            await page.getByTestId('guild-text-input-info').fill(INFO);
            await expect(page.getByTestId('guild-text-field-motd').getByTestId('textarea-count'), 'the MOTD counter')
                .toHaveText(`${MOTD.length}/${MOTD_MAX}`);
            await expect(page.getByTestId('guild-text-warnings-motd').locator('[data-warning="newline-in-motd"]'),
                'a MOTD line break warns, never blocks').toBeVisible();

            const saved = textWrite(page, guild.guildId);
            await page.getByTestId('guild-text-save').click();
            expect((await saved).status(), `PUT ${textPath(guild.guildId)}`).toBe(200);
            await expect(motdInput, 'a successful save closes the editor').toBeHidden({ timeout: 15_000 });

            await expect.poll(async () => {
                const t = await textOf(jwt, guild.guildId);
                return { motd: t.motd?.text ?? null, info: t.info?.text ?? null };
            }, { message: 'the saved text must reach the API unchanged' }).toEqual({ motd: MOTD, info: INFO });
            const editor = must((await textOf(jwt, guild.guildId)).motd?.updatedBy, 'motd.updatedBy');

            await expectExactText(card(page).getByTestId('guild-text-motd-text'), MOTD, 'the card shows the MOTD');
            await expectExactText(card(page).getByTestId('guild-text-info-text'), INFO, 'the card shows the Guild Information');
            await expect(card(page).getByTestId('guild-text-motd-updated'), 'the MOTD names its editor').toContainText(editor);
            await expect(card(page).getByTestId('guild-text-hint'), 'the hint is gone once text exists').toHaveCount(0);
            await expect(page.getByTestId('guild-text-edit'), 'an editor gets the header Edit once text exists').toBeVisible();

            await copyAndRead(page, 'motd', MOTD);
            await expect(block(page, 'motd').getByRole('button', { name: 'Copied' }), 'the copy confirms').toBeVisible();
            await copyAndRead(page, 'info', INFO);
        } finally {
            await removeUsers(admin, guild);
        }
    });

    test('T2 member: sees the text and copies it exactly, with no Edit control', async ({ page }, testInfo) => {
        const admin = await getAdminToken();
        const guild = await seedGuild(admin, testInfo);
        try {
            const put = (await apiPut(admin, textPath(guild.guildId), {
                motd: MOTD, info: INFO, baseMotdUpdatedAt: null, baseInfoUpdatedAt: null,
            })) as Partial<IngameText> | null;
            expect(put?.motd?.text, `admin PUT ${textPath(guild.guildId)}: ${JSON.stringify(put)}`).toBe(MOTD);

            await installCopyRecorder(page);
            const jwt = await signInOnboardedMember(page, guild.users.member.userId);
            await expect.poll(async () => {
                const t = await textOf(jwt, guild.guildId);
                return { motd: t.motd?.text ?? null, info: t.info?.text ?? null, canEdit: t.viewer.canEdit };
            }, { message: 'a plain member reads the text but cannot edit' }).toEqual({ motd: MOTD, info: INFO, canEdit: false });

            await openOverview(page, guild.guildId);
            await expectExactText(card(page).getByTestId('guild-text-motd-text'), MOTD, 'a member sees the MOTD');
            await expectExactText(card(page).getByTestId('guild-text-info-text'), INFO, 'a member sees the Guild Information');
            await expect(page.getByTestId('guild-text-edit'), 'a member has no Edit control').toHaveCount(0);
            await expect(page.getByTestId('guild-text-add'), 'a member has no Add control').toHaveCount(0);

            await copyAndRead(page, 'motd', MOTD);
            await copyAndRead(page, 'info', INFO);
        } finally {
            await removeUsers(admin, guild);
        }
    });

    test('T3 editor: 255 / 499 caps with the shared counter, | warns, a control character blocks Save', async ({ page }, testInfo) => {
        const admin = await getAdminToken();
        const guild = await seedGuild(admin, testInfo);
        try {
            const jwt = await signInOnboardedMember(page, guild.users.officer.userId);
            expect((await textOf(jwt, guild.guildId)).viewer.canEdit, 'the officer can edit').toBe(true);
            await openOverview(page, guild.guildId);
            const motdInput = await openEditorFromHint(page);
            const infoInput = page.getByTestId('guild-text-input-info');
            const save = page.getByTestId('guild-text-save');

            await motdInput.fill('M'.repeat(MOTD_MAX + 45));
            await expect(motdInput, 'the MOTD box stops at the in-game 255').toHaveValue('M'.repeat(MOTD_MAX));
            await expect(page.getByTestId('guild-text-field-motd').getByTestId('textarea-count')).toHaveText(`${MOTD_MAX}/${MOTD_MAX}`);
            await infoInput.fill('I'.repeat(INFO_MAX + 21));
            await expect(infoInput, 'the Guild Information box stops at the in-game 499').toHaveValue('I'.repeat(INFO_MAX));
            await expect(page.getByTestId('guild-text-field-info').getByTestId('textarea-count')).toHaveText(`${INFO_MAX}/${INFO_MAX}`);

            await infoInput.fill('Loot |cffff0000council|r tonight');
            await expect(page.getByTestId('guild-text-warnings-info').locator('[data-warning="pipe"]'),
                '| warns about WoW colour codes').toBeVisible();
            await expect(save, 'a warning never blocks Save').toBeEnabled();

            await setRawValue(motdInput, 'Raid\u0007night');
            await expect(page.getByTestId('guild-text-field-motd'), 'a control character shows the field error')
                .toContainText(CONTROL_CHAR_COPY);
            await expect(save, 'a control character blocks Save').toBeDisabled();
            await motdInput.fill('Raid night');
            await expect(save, 'removing it unblocks Save').toBeEnabled();
            await expect(page.getByTestId('guild-text-field-motd')).not.toContainText(CONTROL_CHAR_COPY);

            await page.getByTestId('guild-text-cancel').click();
            const confirm = page.getByTestId('discard-changes-confirm');
            await expect(confirm, 'a dirty Cancel asks first').toBeVisible();
            await confirm.getByTestId('discard-changes-discard').click();
            await expect(motdInput, 'discarding closes the editor').toBeHidden({ timeout: 15_000 });
            const after = await textOf(jwt, guild.guildId);
            expect({ motd: after.motd, info: after.info }, 'nothing was saved').toEqual({ motd: null, info: null });
        } finally {
            await removeUsers(admin, guild);
        }
    });

    test('T4 editor: Changed in game → Use in-game text adopts it; a newer report → Keep hub text keeps the hub text with the Copy hint', async ({ page }, testInfo) => {
        const admin = await getAdminToken();
        const guild = await seedGuild(admin, testInfo);
        const gid = guild.guildId;
        try {
            const put = (await apiPut(admin, textPath(gid), {
                motd: MOTD, info: INFO, baseMotdUpdatedAt: null, baseInfoUpdatedAt: null,
            })) as Partial<IngameText> | null;
            expect(put?.info?.text, `admin PUT ${textPath(gid)}: ${JSON.stringify(put)}`).toBe(INFO);
            await seedGameText(admin, gid, { motd: GAME_MOTD });

            const jwt = await signInOnboardedMember(page, guild.users.officer.userId);
            await expectFieldState(jwt, gid, 'motd', { text: MOTD, changed: true }, 'the seeded MOTD report differs from the hub text');
            await openOverview(page, gid);
            const motdNotice = card(page).getByTestId('guild-text-motd-game');
            await expect(motdNotice, 'the editor sees the MOTD notice').toContainText('Changed in game', { timeout: 15_000 });
            await expect(card(page).getByTestId('guild-text-info-game'), 'the unreported Info has no notice').toHaveCount(0);

            const adopted = gameAction(page, gid, 'motd', 'adopt');
            await card(page).getByTestId('guild-text-motd-adopt').click();
            expect((await adopted).status(), 'POST …/motd/adopt').toBe(200);
            await expectExactText(card(page).getByTestId('guild-text-motd-text'), GAME_MOTD, 'Use in-game text makes it the hub MOTD');
            await expect(motdNotice, 'the MOTD notice is gone after Use in-game text').toHaveCount(0);
            await expectFieldState(jwt, gid, 'motd', { text: GAME_MOTD, changed: false }, 'Adopt stored the in-game MOTD as the hub text');

            await seedGameText(admin, gid, { info: GAME_INFO });
            await expectFieldState(jwt, gid, 'info', { text: INFO, changed: true }, 'the newer Info report differs from the hub text');
            await openOverview(page, gid);
            const infoNotice = card(page).getByTestId('guild-text-info-game');
            await expect(infoNotice, 'the editor sees the Info notice').toContainText('Changed in game', { timeout: 15_000 });

            const kept = gameAction(page, gid, 'info', 'push');
            await card(page).getByTestId('guild-text-info-keep').click();
            expect((await kept).status(), 'POST …/info/push').toBe(200);
            await expect(card(page).getByTestId('guild-text-info-kept'), 'Keep hub text shows the Copy hint')
                .toHaveText(KEPT_HINT, { timeout: 15_000 });
            await expect(infoNotice, 'the Info notice is gone after Keep hub text').toHaveCount(0);
            await expectExactText(card(page).getByTestId('guild-text-info-text'), INFO, 'Keep hub text leaves the hub Info unchanged');
            await expectFieldState(jwt, gid, 'info', { text: INFO, changed: false }, 'Push acknowledged the report; the hub Info is unchanged');
        } finally {
            await removeUsers(admin, guild);
        }
    });
});
