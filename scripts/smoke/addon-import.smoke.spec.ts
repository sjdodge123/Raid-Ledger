/**
 * ROK-1724 — the LedgerLink addon "Import string" dialog on a WoW: Forever
 * character page (paste → preview → result; Modal ≥1024px, BottomSheet below).
 *
 * Self-contained fixture: every test creates its own Forever character for the
 * signed-in admin via the API, and builds its import string in-spec from the
 * contract's golden fixture (`packages/contract/ledgerlink/v1/fixtures/
 * char-normal.json`) with `who` swapped for a per-test name + GUID, then
 * zlib + base64 + `!RL1!char!` exactly as CONTRACT.md §1 (and the api
 * `addon-fixture.builder.ts`) encode it. A unique name and GUID per test keep
 * parallel projects off each other: Forever names are unique per region and
 * `idx_characters_addon_guid` is unique per game + region. Nothing relies on
 * the demo seed except the boot-seeded game row (resolved by slug, else skip).
 * Every character created is deleted in `afterAll`.
 *
 * ROK-1738 — "Import LedgerLink character" at the top of Add Character (the
 * id-less create route): paste an export for a character not on the account →
 * create banner → Import → lands on `/characters/:id`; and an export with no
 * ruleset → the picker gates Import until a ruleset is picked. The import
 * dialog stacks over Add Character (Modal ≥1024px, `stacked` BottomSheet below);
 * the created id is claimed from the apply response before any UI assertion.
 */
import { deflateSync, inflateSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { signInContextWithJwt } from './browser-session';
import { apiDelete, apiGet, apiPost, apiPut, getAdminToken, getInviteeFixture } from './api-helpers';

const GAME_SLUG = 'world-of-warcraft-forever';

let gameId: number | null = null;
const createdIds: string[] = [];

/** Digits → letters (0→a … 9→j); Forever names are letters only. */
function lettersOnly(digits: string): string {
    return digits.replace(/\d/g, (d) => String.fromCharCode(97 + Number(d)));
}

/** A unique "First Second" name per test, project, worker and run. */
function uniqueName(testInfo: TestInfo, first: string): string {
    const suffix = lettersOnly(`${Date.now() % 1e10}${testInfo.workerIndex}${testInfo.repeatEachIndex}`);
    return `${first} Q${suffix}`;
}

const HEADER = '!RL1!char!';

/**
 * The golden char wire payload, decoded from the `.txt` export string (the
 * sibling `.json` is the decoder's OUTPUT shape — e.g. gear `bonusIds` — and
 * fails the strict wire schema). `process.cwd()` is the repo root for every
 * `npx playwright test` (see scripts/auth-paths.ts, ROK-1286).
 */
function goldenCharPayload(): { who: Record<string, unknown> } & Record<string, unknown> {
    const file = path.resolve(process.cwd(), 'packages/contract/ledgerlink/v1/fixtures/char-normal.txt');
    const token = readFileSync(file, 'utf8').trim();
    if (!token.startsWith(HEADER)) throw new Error(`char-normal.txt should start with ${HEADER}`);
    return JSON.parse(inflateSync(Buffer.from(token.slice(HEADER.length), 'base64')).toString('utf8'));
}

/** The golden char export re-pointed at `fullName` with a fresh GUID (plus `whoOverrides`), re-encoded as a paste. */
function buildImportString(fullName: string, whoOverrides: Record<string, unknown> = {}): string {
    const golden = goldenCharPayload();
    const guid = `Player-4395-${randomBytes(4).toString('hex').toUpperCase()}`;
    const raw = { getUnitName: fullName, unitName: [fullName, null] };
    const who = { ...golden.who, guid, fullName, raw, ...whoOverrides };
    const body = deflateSync(Buffer.from(JSON.stringify({ ...golden, who }), 'utf8')).toString('base64');
    return `${HEADER}${body}`;
}

/** Create a Forever character (US, the fixture's `client.region: 1`) and claim its id for cleanup. */
async function createForeverCharacter(token: string, fullName: string): Promise<string> {
    const created = (await apiPost(token, '/users/me/characters', { gameId, name: fullName, region: 'us', ruleset: 'normal' })) as {
        id?: string;
        message?: unknown;
    };
    expect(created.id, `API create of "${fullName}" should succeed: ${JSON.stringify(created.message ?? '')}`).toBeTruthy();
    const id = String(created.id);
    createdIds.push(id);
    return id;
}

/** Open the character page as the current session and wait for its heading. */
async function openCharacter(page: Page, id: string, fullName: string): Promise<void> {
    await page.goto(`/characters/${id}`);
    await expect(page.getByRole('heading', { name: fullName, level: 1 })).toBeVisible({ timeout: 15_000 });
}

/** Click "Import string" and return the dialog (Modal or BottomSheet — both are role=dialog). */
async function openImportDialog(page: Page): Promise<Locator> {
    await page.getByRole('button', { name: 'Import string' }).click();
    const dialog = page.getByRole('dialog', { name: 'Import string' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    return dialog;
}

/** Paste `value`, press Check string, and return the dry-run's status + body (for failure messages). */
async function pasteAndCheck(page: Page, dialog: Locator, value: string): Promise<{ status: number; body: string }> {
    await dialog.getByRole('textbox', { name: 'Export string' }).fill(value);
    const preview = page.waitForResponse(
        (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/addon-import'),
        { timeout: 20_000 },
    );
    await dialog.getByRole('button', { name: 'Check string' }).click();
    const res = await preview;
    return { status: res.status(), body: await res.text() };
}

const CREATE_TITLE = 'Import LedgerLink character';

/** Open Add Character with no game picked, then its "Import LedgerLink character" dialog (stacked over it). */
async function openCreateImport(page: Page): Promise<{ add: Locator; dialog: Locator }> {
    await page.goto('/profile/gaming/characters');
    await page.getByRole('button', { name: 'Add Character' }).click();
    const add = page.getByRole('dialog', { name: 'Add Character' });
    await expect(add).toBeVisible({ timeout: 15_000 });
    await expect(add.getByTestId('add-manually-divider'), 'the import entry sits above the manual form').toHaveText(/or add manually/);
    await add.getByRole('button', { name: CREATE_TITLE }).click();
    const dialog = page.getByRole('dialog', { name: CREATE_TITLE });
    await expect(dialog, 'the import dialog opens over Add Character').toBeVisible({ timeout: 10_000 });
    return { add, dialog };
}

/** Press Import, claim the created id from the apply response (before any assertion), and return it. */
async function applyAndClaim(page: Page, dialog: Locator): Promise<string> {
    const applied = page.waitForResponse((r) => {
        if (r.request().method() !== 'POST' || !new URL(r.url()).pathname.endsWith('/characters/addon-import')) return false;
        return (r.request().postDataJSON() as { dryRun?: boolean } | null)?.dryRun === false;
    }, { timeout: 20_000 });
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    const res = await applied;
    const body = (await res.json()) as { target?: { characterId?: string | null } };
    const id = body.target?.characterId;
    if (id) createdIds.push(id);
    expect(res.status(), `the create import should apply: ${JSON.stringify(body)}`).toBe(200);
    expect(id, 'the apply response names the created character').toBeTruthy();
    return String(id);
}

/** After a create import: Add Character is closed and the new character's page is open. */
async function expectLandedOn(page: Page, add: Locator, id: string, fullName: string): Promise<void> {
    await expect(page, 'a confirmed import navigates to the new character').toHaveURL(new RegExp(`/characters/${id}(?:[?#].*)?$`), { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: fullName, level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(add, 'the import closes Add Character').toHaveCount(0);
}

/**
 * File scope (ROK-1739, Codex r2 P2): BOTH suites push into `createdIds`, so the
 * drain runs once after every test in the file, not after the first suite only.
 */
test.afterAll(async () => {
    const token = await getAdminToken();
    for (const id of createdIds.splice(0)) await apiDelete(token, `/users/me/characters/${id}`);
});

test.describe('Addon Import string dialog (ROK-1724)', () => {
    test.beforeAll(async () => {
        const token = await getAdminToken();
        const game = (await apiGet(token, `/games/slug/${GAME_SLUG}`)) as { id?: number } | null;
        gameId = game?.id ?? null;
    });

    test.beforeEach(() => {
        test.skip(gameId === null, `"${GAME_SLUG}" is not in this env (boot seed seed-games.data.ts did not run)`);
    });

    test('owner: paste → preview → Import → result; re-paste is a no-op', async ({ page }, testInfo) => {
        const token = await getAdminToken();
        const fullName = uniqueName(testInfo, 'Smokeimport');
        const id = await createForeverCharacter(token, fullName);
        const importString = buildImportString(fullName);

        await openCharacter(page, id, fullName);
        const dialog = await openImportDialog(page);
        const first = await pasteAndCheck(page, dialog, importString);
        expect(first.status, `the matching export's preview should succeed: ${first.body}`).toBe(200);
        await expect(dialog.getByTestId('addon-import-error'), 'the matching export should not be rejected').toHaveCount(0);
        // char-normal.json: 2 gear items (ilvl 80 + 76), 1 talent node, 1 lockout; PALADIN 60 vs a class-less row.
        await expect(dialog, 'the preview summarises the golden char export').toContainText('2 items · avg ilvl 78');
        await expect(dialog).toContainText('1 nodes');
        await expect(dialog, 'the preview shows the class diff').toContainText('→ Paladin');
        await expect(dialog.getByTestId('addon-import-provenance')).toContainText('via addon');
        const importButton = dialog.getByRole('button', { name: 'Import', exact: true });
        await expect(importButton, 'a fresh export is importable').toBeEnabled();

        await importButton.click();
        await expect(dialog.getByTestId('addon-import-success'), 'the first import applies').toHaveText('Character data imported.', {
            timeout: 15_000,
        });

        await dialog.getByRole('button', { name: 'Import another' }).click();
        await pasteAndCheck(page, dialog, importString);
        await expect(dialog.getByTestId('addon-import-status-note'), 'the same export again has nothing new').toHaveText(
            'Already imported — this export has no new data.',
        );
        await expect(dialog.getByRole('button', { name: 'Import', exact: true }), 'a no-op preview cannot be applied').toBeDisabled();
    });

    test('wrong name: NAME_MISMATCH error links to a prefilled Add Character', async ({ page }, testInfo) => {
        const token = await getAdminToken();
        const fullName = uniqueName(testInfo, 'Smokeowner');
        const otherName = uniqueName(testInfo, 'Smokeother');
        const id = await createForeverCharacter(token, fullName);

        await openCharacter(page, id, fullName);
        const dialog = await openImportDialog(page);
        const checked = await pasteAndCheck(page, dialog, buildImportString(otherName));
        expect(checked.body, 'the API should reject another character\'s export as NAME_MISMATCH').toContain('NAME_MISMATCH');

        const error = dialog.getByTestId('addon-import-error');
        await expect(error, 'an export from another character is NAME_MISMATCH').toContainText('Different character');
        await expect(dialog.getByRole('button', { name: 'Import', exact: true }), 'a rejected paste never reaches preview').toHaveCount(0);
        const link = error.getByRole('link', { name: 'Add this character' });
        await expect(link).toHaveAttribute('href', '/profile/gaming/characters');

        await link.click();
        await expect(page).toHaveURL(/\/profile\/gaming\/characters/);
        const add = page.getByRole('dialog', { name: 'Add Character' });
        await expect(add, 'the link opens Add Character').toBeVisible({ timeout: 15_000 });
        await expect(add.getByRole('textbox', { name: 'First name', exact: true }), 'prefilled from the export').toHaveValue('Smokeother');
    });

    test('non-owner: the Import string button is not shown', async ({ page }, testInfo) => {
        const adminToken = await getAdminToken();
        const fullName = uniqueName(testInfo, 'Smokeviewed');
        const id = await createForeverCharacter(adminToken, fullName);
        const invitee = await getInviteeFixture();

        // Sign in as the invitee BEFORE the first navigation (the pattern of
        // scheduling-poll-live-updates / game-badges-personalization): the
        // context's rl_rt cookie is swapped to the invitee's own refresh family
        // before any document loads (ROK-1754), so no admin page load ever runs
        // and no admin `/auth/me` can be caught.
        await signInContextWithJwt(page.context(), invitee.jwt);
        // Wait for the page's authenticated `/auth/me` (the token is minted in
        // memory at boot, so it is not invitee.jwt; the body check below pins the user),
        // registered before navigating, so "no button" is not just "user not loaded yet".
        const me = page.waitForResponse(
            (r) =>
                new URL(r.url()).pathname.endsWith('/auth/me') &&
                (r.request().headers()['authorization'] ?? '').startsWith('Bearer '),
            { timeout: 20_000 },
        );
        await openCharacter(page, id, fullName);
        const meResponse = await me;
        expect(meResponse.status(), 'the invitee session should load').toBe(200);
        const meBody = (await meResponse.json()) as { id?: number | string };
        expect(String(meBody.id), 'the page should be signed in as the invitee').toBe(String(invitee.userId));
        await expect(
            page.getByRole('button', { name: 'Import string' }),
            "another player's Forever character has no Import string button",
        ).toHaveCount(0);
    });

    test('create: Add Character → Import LedgerLink character → create banner → Import → character page (ROK-1738)', async ({ page }, testInfo) => {
        const fullName = uniqueName(testInfo, 'Smokecreate');
        const { add, dialog } = await openCreateImport(page);
        const checked = await pasteAndCheck(page, dialog, buildImportString(fullName));
        expect(checked.status, `the create preview should succeed: ${checked.body}`).toBe(200);
        await expect(dialog.getByTestId('addon-import-error'), 'a new character\'s export should not be rejected').toHaveCount(0);

        const banner = dialog.getByTestId('addon-import-target');
        await expect(banner, 'a character not on the account is a create').toHaveAttribute('data-action', 'create');
        // char-normal.json: region 1 (US), ruleset normal, PALADIN 60.
        await expect(banner).toContainText(`Creates ${fullName} · US`);
        await expect(banner).toContainText('Level 60 Paladin');
        await expect(dialog.getByTestId('addon-import-ruleset-picker'), 'the export names its ruleset → no picker').toHaveCount(0);

        const id = await applyAndClaim(page, dialog);
        await expectLandedOn(page, add, id, fullName);
    });

    test('create: an export with no ruleset needs a pick before Import (ROK-1738)', async ({ page }, testInfo) => {
        const fullName = uniqueName(testInfo, 'Smokepick');
        const { add, dialog } = await openCreateImport(page);
        const checked = await pasteAndCheck(page, dialog, buildImportString(fullName, { ruleset: null }));
        expect(checked.status, `the null-ruleset preview should succeed: ${checked.body}`).toBe(200);

        const banner = dialog.getByTestId('addon-import-target');
        await expect(banner).toHaveAttribute('data-action', 'create');
        await expect(banner, 'the banner says the export has no ruleset').toContainText('ruleset not in export');
        const picker = dialog.getByTestId('addon-import-ruleset-picker');
        await expect(picker, 'a null-ruleset export shows the picker').toBeVisible();
        const importButton = dialog.getByRole('button', { name: 'Import', exact: true });
        await expect(importButton, 'Import waits for a ruleset').toBeDisabled();

        await picker.getByText('PvP', { exact: true }).click();
        await expect(picker.getByRole('radio', { name: 'PvP' }), 'the picked ruleset is checked').toBeChecked();
        await expect(importButton, 'a picked ruleset enables Import').toBeEnabled();

        const id = await applyAndClaim(page, dialog);
        await expectLandedOn(page, add, id, fullName);
        const token = await getAdminToken();
        const created = (await apiGet(token, `/characters/${id}`)) as { ruleset?: string | null } | null;
        expect(created?.ruleset, 'the character is created with the picked ruleset').toBe('pvp');
    });
});

/* ---------- ROK-1739: realm → ruleset inference (spec §7 P1/P2) ---------- */

const REALM_MAP_PATH = '/admin/plugins/blizzard/forever/realm-rulesets';
/**
 * Smoke-only realms, IDENTICAL for desktop and mobile so their concurrent
 * upserts converge. They are deliberately NOT removed in afterAll: the realm
 * map is one global row and the two projects run in parallel, so a restore
 * from whichever finishes first would pull the realm out from under the other.
 */
const INFER_PVP = 'Smokeinfer Pvp';
const INFER_HC = 'Smokeinfer Hardcore';
type RealmEntry = { region: string; realmName: string; ruleset: string };
const realmKey = (e: RealmEntry): string => `${e.region}:${e.realmName.toLowerCase()}`;

async function readRealmMap(token: string): Promise<RealmEntry[]> {
    const map = (await apiGet(token, REALM_MAP_PATH)) as { entries?: RealmEntry[] } | null;
    expect(Array.isArray(map?.entries), `GET realm map should return entries: ${JSON.stringify(map)}`).toBe(true);
    return map?.entries ?? [];
}

/** Replace the realms named in `drop` with `add` (by region + realm name), keeping every other entry. */
async function editRealmMap(token: string, add: RealmEntry[], drop: RealmEntry[] = add): Promise<void> {
    const gone = new Set(drop.map(realmKey));
    const kept = (await readRealmMap(token)).filter((e) => !gone.has(realmKey(e)));
    const saved = (await apiPut(token, REALM_MAP_PATH, { entries: [...kept, ...add] })) as { entries?: RealmEntry[] };
    expect(Array.isArray(saved.entries), `PUT realm map should save: ${JSON.stringify(saved)}`).toBe(true);
}

/**
 * Add only the rows of `want` the map lacks (or holds with another ruleset), keeping every other
 * entry — and write nothing when all are present. Every project's beforeAll runs this while
 * desktop's P2 saves the WHOLE map from the editor; an unconditional read-then-write landing after
 * that save would drop P2's row. Once the seed exists no beforeAll writes again, so P2's row is safe.
 */
async function ensureRealms(token: string, want: RealmEntry[]): Promise<void> {
    const have = new Set((await readRealmMap(token)).map((e) => `${realmKey(e)}=${e.ruleset}`));
    const missing = want.filter((e) => !have.has(`${realmKey(e)}=${e.ruleset}`));
    if (missing.length > 0) await editRealmMap(token, missing);
}

/** A null-ruleset export whose raw `GetRealmName()` is `realmName`. */
function realmImportString(fullName: string, realmName: string): string {
    return buildImportString(fullName, { ruleset: null, raw: { getUnitName: fullName, unitName: [fullName, null], realmName } });
}

test.describe('Addon import — realm-inferred ruleset (ROK-1739)', () => {
    test.beforeAll(async () => {
        const token = await getAdminToken();
        if (gameId === null) {
            const game = (await apiGet(token, `/games/slug/${GAME_SLUG}`)) as { id?: number } | null;
            gameId = game?.id ?? null;
        }
        await ensureRealms(token, [
            { region: 'us', realmName: INFER_PVP, ruleset: 'pvp' },
            { region: 'us', realmName: INFER_HC, ruleset: 'hardcore' },
        ]);
    });

    test('P1 per-character: an inferred ruleset change names the realm and stays opt-in', async ({ page }, testInfo) => {
        const token = await getAdminToken();
        const fullName = uniqueName(testInfo, 'Smokeinfer');
        const id = await createForeverCharacter(token, fullName);
        await openCharacter(page, id, fullName);
        const dialog = await openImportDialog(page);
        const checked = await pasteAndCheck(page, dialog, realmImportString(fullName, INFER_PVP));
        expect(checked.status, `the inferred preview should succeed: ${checked.body}`).toBe(200);

        const warning = dialog.getByTestId('addon-import-warning');
        await expect(warning, 'the warning names the realm the ruleset was inferred from')
            .toContainText(`Realm "${INFER_PVP}" is listed as PvP — this character is Normal here.`);
        await expect(dialog.getByTestId('addon-import-inference-source'))
            .toHaveText('Inferred from the realm list your admin maintains — not from the export.');
        await dialog.getByRole('checkbox', { name: 'Update ruleset to PvP' }).check();
        await dialog.getByRole('button', { name: 'Import', exact: true }).click();
        await expect(dialog.getByTestId('addon-import-success')).toHaveText('Character data imported.', { timeout: 20_000 });
        await expect.poll(async () => ((await apiGet(token, `/characters/${id}`)) as { ruleset?: string | null } | null)?.ruleset,
            { message: 'the opted-in inferred ruleset is written', timeout: 15_000 }).toBe('pvp');
    });

    test('P1 create: the picker is pre-selected from the realm and the character is created with it', async ({ page }, testInfo) => {
        const fullName = uniqueName(testInfo, 'Smokeinfercreate');
        const { add, dialog } = await openCreateImport(page);
        const checked = await pasteAndCheck(page, dialog, realmImportString(fullName, INFER_PVP));
        expect(checked.status, `the inferred create preview should succeed: ${checked.body}`).toBe(200);

        await expect(dialog.getByTestId('addon-import-target'), 'the target line labels the ruleset as inferred')
            .toContainText(`PvP (inferred from ${INFER_PVP})`);
        const picker = dialog.getByTestId('addon-import-ruleset-picker');
        await expect(picker.getByRole('radio', { name: 'PvP' }), 'the inferred ruleset is pre-selected').toBeChecked();
        await expect(dialog.getByTestId('addon-import-ruleset-inference'))
            .toHaveText(`Pre-selected from realm ${INFER_PVP} — change it if that's wrong.`);

        const id = await applyAndClaim(page, dialog);
        await expectLandedOn(page, add, id, fullName);
        const token = await getAdminToken();
        await expect.poll(async () => ((await apiGet(token, `/characters/${id}`)) as { ruleset?: string | null } | null)?.ruleset,
            { message: 'the character is created with the pre-selected ruleset', timeout: 15_000 }).toBe('pvp');
    });

    test('P1 create: a Hardcore realm is reported but never pre-selected', async ({ page }, testInfo) => {
        const fullName = uniqueName(testInfo, 'Smokeinferhc');
        const { dialog } = await openCreateImport(page);
        const checked = await pasteAndCheck(page, dialog, realmImportString(fullName, INFER_HC));
        expect(checked.status, `the Hardcore-realm preview should succeed: ${checked.body}`).toBe(200);

        await expect(dialog.getByTestId('addon-import-target')).toContainText('ruleset not in export');
        const picker = dialog.getByTestId('addon-import-ruleset-picker');
        await expect(picker.getByRole('radio', { checked: true }), 'a Hardcore inference leaves the picker empty').toHaveCount(0);
        await expect(dialog.getByTestId('addon-import-ruleset-inference'))
            .toHaveText(`Realm ${INFER_HC} is listed as Hardcore, which can't be added yet — pick a ruleset.`);
        await expect(dialog.getByRole('button', { name: 'Import', exact: true }), 'Import waits for a pick').toBeDisabled();
    });

    test('P2 admin editor: an added realm row persists across a reload', async ({ page }, testInfo) => {
        // The editor saves the WHOLE map; two projects saving at once would drop each other's row, so desktop owns this
        // round-trip — and the beforeAll seed (ensureRealms) never rewrites an already-seeded map, so nothing else races it.
        test.skip(testInfo.project.name !== 'desktop', 'whole-map save — one project only (see comment)');
        const token = await getAdminToken();
        const realm = uniqueName(testInfo, 'Smokeeditor');
        const row: RealmEntry = { region: 'us', realmName: realm, ruleset: 'pvp' };
        try {
            await page.goto('/admin/settings/integrations');
            const href = await page.locator('a[href*="/integrations/plugin/blizzard/"]').first().getAttribute('href', { timeout: 15_000 });
            expect(href, 'the Blizzard integration panel is linked from Integrations').toBeTruthy();
            await page.goto(String(href));
            const section = page.getByRole('region', { name: 'Realm rulesets' });
            await expect(section).toBeVisible({ timeout: 15_000 });
            const names = section.getByRole('textbox', { name: /^Realm name, row \d+$/ });
            const n = (await names.count()) + 1;
            await section.getByRole('button', { name: 'Add realm' }).click();
            await section.getByRole('textbox', { name: `Realm name, row ${n}` }).fill(realm);
            await section.getByRole('combobox', { name: `Ruleset, row ${n}` }).selectOption('pvp');
            const put = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/forever/realm-rulesets'));
            await section.getByRole('button', { name: 'Save realm rulesets' }).click();
            expect((await put).status(), 'the realm map saves').toBe(200);

            await page.reload();
            await expect(section).toBeVisible({ timeout: 15_000 });
            await expect.poll(() => names.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)),
                { message: `the saved realm "${realm}" is listed after a reload`, timeout: 15_000 }).toContain(realm);
        } finally {
            await editRealmMap(token, [], [row]);
        }
    });
});
