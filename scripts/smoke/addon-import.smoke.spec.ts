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
 */
import { deflateSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, apiPost, getAdminToken, getInviteeFixture } from './api-helpers';
import golden from '../../packages/contract/ledgerlink/v1/fixtures/char-normal.json';

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

/** The golden char export re-pointed at `fullName` with a fresh GUID, encoded as a paste. */
function buildImportString(fullName: string): string {
    const guid = `Player-4395-${randomBytes(4).toString('hex').toUpperCase()}`;
    const who = { ...golden.payload.who, guid, fullName, raw: { getUnitName: fullName, unitName: [fullName, null] } };
    const payload = { ...golden.payload, who };
    const body = deflateSync(Buffer.from(JSON.stringify(payload), 'utf8')).toString('base64');
    return `!RL1!char!${body}`;
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

/** Paste `value` and press Check string, waiting on the dry-run response. */
async function pasteAndCheck(page: Page, dialog: Locator, value: string): Promise<void> {
    await dialog.getByRole('textbox', { name: 'Export string' }).fill(value);
    const preview = page.waitForResponse(
        (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/addon-import'),
        { timeout: 20_000 },
    );
    await dialog.getByRole('button', { name: 'Check string' }).click();
    await preview;
}

test.describe('Addon Import string dialog (ROK-1724)', () => {
    test.beforeAll(async () => {
        const token = await getAdminToken();
        const game = (await apiGet(token, `/games/slug/${GAME_SLUG}`)) as { id?: number } | null;
        gameId = game?.id ?? null;
    });

    test.afterAll(async () => {
        const token = await getAdminToken();
        for (const id of createdIds.splice(0)) await apiDelete(token, `/users/me/characters/${id}`);
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
        await pasteAndCheck(page, dialog, importString);

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
        await pasteAndCheck(page, dialog, buildImportString(otherName));

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

        await page.goto('/');
        await page.evaluate((t) => localStorage.setItem('raid_ledger_token', t), invitee.jwt);
        // Wait for the session user to load as the invitee, so "no button" is not just "user not loaded yet".
        const me = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/auth/me') && r.ok(), { timeout: 20_000 });
        await openCharacter(page, id, fullName);
        const meBody = (await (await me).json()) as { id?: number | string };
        expect(String(meBody.id), 'the page should be signed in as the invitee').toBe(String(invitee.userId));
        await expect(
            page.getByRole('button', { name: 'Import string' }),
            "another player's Forever character has no Import string button",
        ).toHaveCount(0);
    });
});
