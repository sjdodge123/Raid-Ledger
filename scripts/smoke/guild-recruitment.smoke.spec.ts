/**
 * ROK-1789 Part A — the WoW: Forever hub "Recruitment" card (`blizzard` widget
 * `forever-recruitment`) and its editor: a `Modal` at ≥1024px, a `BottomSheet`
 * below (every Playwright project runs it; the overlay check branches on width).
 *
 * Fixture: `POST /admin/test/wow/seed-guild` with `withRecruitment: true` and a
 * per-project, per-worker, per-run name — a fresh Forever guild whose rank-0 GM
 * saved `SEED_GUILD_RECRUITMENT` (Priest/healer Open "Holy", Warlock/dps Open,
 * Druid/tank Limited "Exceptional only", Rogue/dps Closed, apply link).
 * Every write is confirmed by polling the API (memory
 * `feedback_smoke_polling_for_async_writes`). Seeded users are deleted in `finally`.
 */
import type { Locator, Page, Response, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { API_BASE, apiDelete, apiGet, apiPost, getAdminToken } from './api-helpers';
import { signInOnboardedMember } from './browser-session';

const GAME_SLUG = 'world-of-warcraft-forever';
const APPLY_URL = 'https://example.com/apply';
const DESKTOP_MIN_WIDTH = 1024;

type Role = 'gm' | 'officer' | 'member' | 'outsider';
type RowState = 'open' | 'limited' | 'closed';

interface SeededGuild { guildId: number; users: Record<Role, { userId: number }> }
interface Wanted { className: string; role: string; state: RowState; note?: string }
interface RecruitmentView {
    recruitment: { recruiting: boolean; wanted: Wanted[]; applyUrl: string | null } | null;
    state: RowState | null;
    viewer: { canEdit: boolean };
}

let gameAvailable = false;

/** Fail loudly on a missing value (strict flags: no `!`). */
function must<T>(value: T | undefined | null, label: string): T {
    if (value === undefined || value === null) throw new Error(`[guild-recruitment] missing ${label}`);
    return value;
}

function guildName(testInfo: TestInfo): string {
    return `Recruit ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`;
}

async function seedGuild(token: string, testInfo: TestInfo): Promise<SeededGuild> {
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', {
        name: guildName(testInfo), gameSlug: GAME_SLUG, withRecruitment: true,
    })) as (Partial<SeededGuild> & { recruitment?: unknown }) | null;
    if (typeof body?.guildId !== 'number' || !body.users || !body.recruitment) {
        throw new Error(`[guild-recruitment] seed-guild withRecruitment: ${JSON.stringify(body)}`);
    }
    return { guildId: body.guildId, users: body.users };
}

async function removeUsers(token: string, guild: SeededGuild): Promise<void> {
    for (const user of Object.values(guild.users)) {
        await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
    }
}

const recruitPath = (guildId: number): string => `/plugins/wow/guilds/${guildId}/recruitment`;

async function viewOf(jwt: string, guildId: number): Promise<RecruitmentView> {
    return must((await apiGet(jwt, recruitPath(guildId))) as RecruitmentView | null, `GET ${recruitPath(guildId)}`);
}

/** `className:state` per stored row, for compact poll comparisons. */
async function storedRows(jwt: string, guildId: number): Promise<{ recruiting: boolean | null; rows: string[] }> {
    const r = (await viewOf(jwt, guildId)).recruitment;
    return { recruiting: r?.recruiting ?? null, rows: (r?.wanted ?? []).map((w) => `${w.className}:${w.state}`) };
}

const card = (page: Page): Locator => page.locator('#hub-widget-blizzard-forever-recruitment').getByTestId('recruitment-card');
const rows = (page: Page): Locator => card(page).getByTestId('recruitment-row');

async function openOverview(page: Page, guildId: number): Promise<void> {
    const loaded = page.waitForResponse(
        (r) => r.request().method() === 'GET' && new URL(r.url()).pathname.endsWith(recruitPath(guildId)),
        { timeout: 20_000 },
    );
    await page.goto(`/hubs/${guildId}`);
    await expect(page.getByTestId('guild-overview')).toBeVisible({ timeout: 15_000 });
    expect((await loaded).status(), `GET ${recruitPath(guildId)}`).toBe(200);
}

/** Card rows in display order as `Class:Chip`. */
async function expectCardRows(page: Page, expected: string[], message: string): Promise<void> {
    await expect.poll(async () => {
        const out: string[] = [];
        for (const row of await rows(page).all()) {
            const cls = await row.getAttribute('data-class');
            out.push(`${cls ?? '?'}:${(await row.getByTestId('recruitment-row-state').innerText()).trim()}`);
        }
        return out;
    }, { message, timeout: 15_000 }).toEqual(expected);
}

/** Header Edit → the editor; checks Modal (≥1024px) vs BottomSheet (below). */
async function openEditor(page: Page): Promise<Locator> {
    await page.getByTestId('recruitment-edit').click();
    const recruiting = page.getByTestId('recruitment-recruiting');
    await expect(recruiting, 'the Recruitment editor opens').toBeVisible({ timeout: 15_000 });
    const desktop = (page.viewportSize()?.width ?? 0) >= DESKTOP_MIN_WIDTH;
    await expect(page.getByTestId('bottom-sheet-footer'), desktop ? 'desktop edits in a modal' : 'phone/tablet edits in a bottom sheet')
        .toHaveCount(desktop ? 0 : 1);
    return recruiting;
}

async function saveEditor(page: Page, guildId: number): Promise<void> {
    const put = page.waitForResponse(
        (r: Response) => r.request().method() === 'PUT' && new URL(r.url()).pathname.endsWith(recruitPath(guildId)),
        { timeout: 20_000 },
    );
    await page.getByTestId('recruitment-save').click();
    expect((await put).status(), `PUT ${recruitPath(guildId)}`).toBe(200);
    await expect(page.getByTestId('recruitment-recruiting'), 'a successful save closes the editor').toBeHidden({ timeout: 15_000 });
}

/** Editor row index of a class (the editor keeps the stored order). */
async function editorIndexOf(page: Page, className: string): Promise<number> {
    const count = await page.getByTestId('recruitment-wanted-editor').locator('li[data-testid^="recruitment-row-"]').count();
    for (let i = 0; i < count; i++) {
        if ((await page.getByTestId(`recruitment-class-${i}`).inputValue()) === className) return i;
    }
    throw new Error(`[guild-recruitment] no editor row for ${className}`);
}

test.describe('WoW: Forever hub "Recruitment" card (ROK-1789)', () => {
    test.beforeAll(async () => {
        const game = (await apiGet(await getAdminToken(), `/games/slug/${GAME_SLUG}`)) as { id?: number } | null;
        gameAvailable = typeof game?.id === 'number';
    });

    test.beforeEach(() => {
        test.skip(!gameAvailable, `"${GAME_SLUG}" is not in this env (boot seed seed-games.data.ts did not run)`);
    });

    test('member: sees the seeded card (Open headline, sorted rows with own chips, Apply link) and no Edit control', async ({ page }, testInfo) => {
        const admin = await getAdminToken();
        const guild = await seedGuild(admin, testInfo);
        try {
            const jwt = await signInOnboardedMember(page, guild.users.member.userId);
            const view = await viewOf(jwt, guild.guildId);
            expect({ state: view.state, canEdit: view.viewer.canEdit, rows: view.recruitment?.wanted.length },
                'a plain member reads the seeded recruitment but cannot edit').toEqual({ state: 'open', canEdit: false, rows: 4 });

            await openOverview(page, guild.guildId);
            await expect(card(page).getByTestId('recruitment-headline'), 'the headline chip').toHaveText('Open', { timeout: 15_000 });
            await expectCardRows(page, ['Priest:Open', 'Warlock:Open', 'Druid:Limited', 'Rogue:Closed'],
                'rows sort open → limited → closed, each with its own chip');
            await expect(rows(page).filter({ hasText: 'Priest' }), 'the row note shows').toContainText('Holy');
            const apply = card(page).getByRole('link', { name: /Apply to join/ });
            await expect(apply, 'the Apply link points at the seeded URL').toHaveAttribute('href', APPLY_URL);
            await expect(apply, 'the Apply link opens a new tab').toHaveAttribute('target', '_blank');
            await expect(page.getByTestId('recruitment-edit'), 'a plain member has no Edit control').toHaveCount(0);
            await expect(page.getByTestId('recruitment-set'), 'a plain member has no Set control').toHaveCount(0);
        } finally {
            await removeUsers(admin, guild);
        }
    });

    test('rank-0 GM: Recruiting off → Closed keeps the rows; on + Warlock Limited + Mage added → the rows return re-sorted', async ({ page }, testInfo) => {
        test.setTimeout(120_000);
        const admin = await getAdminToken();
        const guild = await seedGuild(admin, testInfo);
        const gid = guild.guildId;
        const seeded = ['Priest:open', 'Warlock:open', 'Druid:limited', 'Rogue:closed'];
        try {
            const jwt = await signInOnboardedMember(page, guild.users.gm.userId);
            expect((await viewOf(jwt, gid)).viewer.canEdit, 'the seeded rank-0 GM can edit').toBe(true);
            await openOverview(page, gid);

            const recruiting = await openEditor(page);
            await expect(recruiting).toBeChecked();
            await recruiting.uncheck();
            await saveEditor(page, gid);
            await expect.poll(() => storedRows(jwt, gid), { message: 'Recruiting off keeps every row and its state' })
                .toEqual({ recruiting: false, rows: seeded });
            await expect(card(page).getByTestId('recruitment-headline'), 'the headline reads Closed').toHaveText('Closed', { timeout: 15_000 });
            await expect(card(page), 'the Closed explainer').toContainText('Not recruiting right now.');
            await expect(rows(page), 'Closed hides the wanted list').toHaveCount(0);
            await expect(card(page).getByRole('link', { name: /Apply to join/ }), 'Closed hides Apply').toHaveCount(0);

            await (await openEditor(page)).check();
            await page.getByTestId(`recruitment-state-${await editorIndexOf(page, 'Warlock')}`).selectOption('limited');
            await page.getByTestId('recruitment-add-row').click();
            const added = seeded.length;
            await page.getByTestId(`recruitment-class-${added}`).selectOption('Mage');
            await page.getByTestId(`recruitment-role-${added}`).selectOption('dps');
            await page.getByTestId(`recruitment-state-${added}`).selectOption('limited');
            await saveEditor(page, gid);
            await expect.poll(() => storedRows(jwt, gid), { message: 'the switch, the Warlock change and the new Mage row are stored' })
                .toEqual({ recruiting: true, rows: ['Priest:open', 'Warlock:limited', 'Druid:limited', 'Rogue:closed', 'Mage:limited'] });
            await expect(card(page).getByTestId('recruitment-headline'), 'an Open row makes the headline Open').toHaveText('Open', { timeout: 15_000 });
            await expectCardRows(page, ['Priest:Open', 'Warlock:Limited', 'Druid:Limited', 'Mage:Limited', 'Rogue:Closed'],
                'the rows return with their own states, re-sorted, without a reload');
            await expect(card(page).getByRole('link', { name: /Apply to join/ }), 'Apply is back').toHaveAttribute('href', APPLY_URL);
        } finally {
            await removeUsers(admin, guild);
        }
    });

    test('outsider: GET is 403 and the join gate shows instead of the card', async ({ page }, testInfo) => {
        const admin = await getAdminToken();
        const guild = await seedGuild(admin, testInfo);
        try {
            const jwt = await signInOnboardedMember(page, guild.users.outsider.userId);
            const res = await fetch(`${API_BASE}${recruitPath(guild.guildId)}`, { headers: { Authorization: `Bearer ${jwt}` } });
            expect(res.status, 'a non-member cannot read recruitment').toBe(403);
            await page.goto(`/hubs/${guild.guildId}`);
            await expect(page.getByTestId('wow-join-gate'), 'a non-member sees the join gate').toBeVisible({ timeout: 20_000 });
            await expect(page.getByTestId('recruitment-card'), 'no Recruitment card behind the gate').toHaveCount(0);
        } finally {
            await removeUsers(admin, guild);
        }
    });
});
