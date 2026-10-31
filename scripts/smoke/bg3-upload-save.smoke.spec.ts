/**
 * ROK-1960 — "Upload a save" on a BG3 `game_community` hub: a member picks the
 * committed synthetic Act 2 `.lsv`, the browser parses it (WASM, no
 * `/companion/*` call before Upload), the preview shows the save name, area and
 * party, Upload files it into the hub's active campaign and the Party widget
 * renders the party (spec §6 AC 1–5, §9 Playwright). Desktop AND mobile.
 *
 * Fixture: `POST /admin/test/bg3/seed-hub` variant `no-saves` (the active
 * campaign "Tactician run" with the host's saves left unassigned) under a tag
 * unique to spec × project × worker (`hubSeedTag`); the seed's reset deletes
 * every save the tag's users uploaded, so each test starts empty. The actor is
 * `bg3-member-<tag>`, a hub member with no saves of their own.
 *
 * The file is sent under a per-run name, so its `file-name` campaign key never
 * matches an earlier run's. Every write is confirmed against
 * `GET /plugins/bg3/hubs/:id/snapshot` with `pollForCondition`. No sleeps.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { API_BASE, apiGet, apiPost, getAdminToken, pollForCondition } from './api-helpers';
import { signInOnboardedMember } from './browser-session';
import { hubSeedTag } from './hub-seed';

const LSV_FIXTURE = join(__dirname, '..', '..', 'web', 'src', 'plugins', 'bg3', 'upload', 'fixtures', 'synthetic-act2.lsv');
/** The fixture's `SaveInfo.json` (see `synthetic-act2.expected.json`). */
const SAVE_NAME = 'QuickSave_1';
const WHERE_TEXT = 'Act 2 · Shadow-Cursed Lands';
const HERO_COUNT = 4;
const PARTY_SIZE = 5; // 4 heroes + 1 summon
/** `BG3_SEED_CAMPAIGN_NAME` — the seed's active campaign. */
const CAMPAIGN_NAME = 'Tactician run';
const UI_TIMEOUT = 20_000;
/** Fixed mtime (2024-01-01T00:00:00Z, seconds) for every picked copy of the fixture. */
const PINNED_MTIME_S = 1_704_067_200;

interface Seed {
    hubId: number;
    memberId: number;
}

type Snapshot = { empty: true } | { empty: false; party: { isSummon: boolean }[] };

interface UploadFile {
    name: string;
    /** Absolute path of the on-disk copy handed to `setInputFiles`. */
    path: string;
}

/** One upload-path request: a companion blob/message or the campaign-key bind. */
interface UploadCall {
    method: string;
    path: string;
    body: string | null;
}

const BLOB_PATH = /\/companion\/v1\/blobs\/([0-9a-f]{64})$/;
const MESSAGE_PATH = /\/companion\/v1\/messages\/bg3-save$/;
const BIND_PATH = /\/me\/campaign-keys\/([0-9a-f]{64})$/;

/** Record every request the upload path makes (blob, bind, message), with its body. */
function watchUploadCalls(page: Page): UploadCall[] {
    const calls: UploadCall[] = [];
    page.on('request', (r) => {
        const path = new URL(r.url()).pathname;
        if (BLOB_PATH.test(path) || MESSAGE_PATH.test(path) || BIND_PATH.test(path)) {
            calls.push({ method: r.method(), path, body: r.method() === 'POST' ? r.postData() : null });
        }
    });
    return calls;
}

const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * AC3 after Upload: exactly one blob PUT, one bind PUT and one message POST
 * (order not pinned), keyed to the payload; the message names neither the
 * per-run file stem nor any path.
 */
function expectUploadCalls(calls: readonly UploadCall[], file: UploadFile): void {
    const label = (c: UploadCall): string => `${c.method} ${c.path}`;
    const blobs = calls.filter((c) => c.method === 'PUT' && BLOB_PATH.test(c.path));
    const binds = calls.filter((c) => c.method === 'PUT' && BIND_PATH.test(c.path));
    const posts = calls.filter((c) => c.method === 'POST' && MESSAGE_PATH.test(c.path));
    expect(blobs.map(label), 'exactly one thumbnail blob PUT').toHaveLength(1);
    expect(binds.map(label), 'exactly one campaign-key bind PUT').toHaveLength(1);
    expect(posts.map(label), 'exactly one bg3-save message POST').toHaveLength(1);
    expect(calls.map(label), 'nothing else on the upload path').toHaveLength(3);
    const body = posts[0]?.body ?? '';
    const stem = file.name.replace(/\.lsv$/i, '');
    expect(body, 'the message never names the per-run file stem').not.toContain(stem);
    expect(body, 'the message never names the file').not.toContain('.lsv');
    expect(body, 'the message carries no Windows path').not.toContain('\\');
    expect(body, 'the message carries no saves path').not.toMatch(/Savegames|PlayerProfiles|Larian Studios/);
    const payload = (JSON.parse(body) as { payload: { campaignKey: string; campaignKeySource: string; thumbnail: { sha256: string } | null } }).payload;
    expect(payload.campaignKeySource, 'a bare file is keyed by its stem').toBe('file-name');
    expect(payload.campaignKey, 'the key is the sha256 of the stem, not the stem').toBe(sha256Hex(stem));
    expect(binds[0]?.path.match(BIND_PATH)?.[1], 'the bind targets the payload campaign key').toBe(payload.campaignKey);
    expect(blobs[0]?.path.match(BLOB_PATH)?.[1], 'the blob is the payload thumbnail').toBe(payload.thumbnail?.sha256);
}

/** The bg3 plugin is not active on a fresh env; install, else activate (a sibling worker won). */
async function ensurePluginActive(token: string, pluginId: string): Promise<void> {
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } };
    const install = await fetch(`${API_BASE}/admin/plugins/${pluginId}/install`, init);
    if (install.ok) return;
    const activate = await fetch(`${API_BASE}/admin/plugins/${pluginId}/activate`, init);
    if (!activate.ok) throw new Error(`failed to enable the ${pluginId} plugin: install ${install.status}, activate ${activate.status}`);
}

async function seedHub(testInfo: TestInfo): Promise<Seed> {
    const token = await getAdminToken();
    const body = (await apiPost(token, '/admin/test/bg3/seed-hub', {
        tag: hubSeedTag('bg3-upload', testInfo),
        variant: 'no-saves',
    })) as { hubId?: unknown; users?: { member?: { userId?: unknown } } } | null;
    const memberId = body?.users?.member?.userId;
    if (typeof body?.hubId !== 'number' || typeof memberId !== 'number') {
        throw new Error(`bg3 seed-hub: ${JSON.stringify(body)}`);
    }
    return { hubId: body.hubId, memberId };
}

/** Per-worker temp dir holding the on-disk fixture copies; created in `beforeAll`, removed in `afterAll`. */
let tempDir: string | null = null;

/**
 * Copy the synthetic save to disk under a name unique to this run (the
 * bare-file campaign key is the file name), as a real user picks it. The
 * mtime is pinned because the web derives `savedAt` from `file.lastModified`:
 * an in-memory buffer gets "now" on every pick, so a replay would look newer
 * and be filed instead of reported as "Already uploaded.".
 */
function uploadFile(testInfo: TestInfo): UploadFile {
    if (tempDir === null) throw new Error('bg3 upload: temp dir not created (beforeAll did not run)');
    const name = `${hubSeedTag('bg3-upload', testInfo)}-${Date.now().toString(36)}.lsv`;
    const path = join(tempDir, name);
    copyFileSync(LSV_FIXTURE, path);
    utimesSync(path, PINNED_MTIME_S, PINNED_MTIME_S);
    return { name, path };
}

/** Poll the hub snapshot until the party has `size` members (heroes + summons). */
async function waitForParty(jwt: string, hubId: number, size: number): Promise<number> {
    return pollForCondition(
        async () => {
            const s = (await apiGet(jwt, `/plugins/bg3/hubs/${hubId}/snapshot`)) as Snapshot | null;
            if (!s || s.empty || s.party.length !== size) return null;
            return s.party.filter((m) => !m.isSummon).length;
        },
        { timeoutMs: 15_000, description: `bg3 snapshot for hub ${hubId}: party of ${size}` },
    );
}

function uploadSheet(page: Page): Locator {
    return page.getByRole('dialog', { name: 'Upload a save' });
}

/** Pick the file in the open sheet and wait for the local preview. */
async function pickSave(page: Page, file: UploadFile): Promise<Locator> {
    const sheet = uploadSheet(page);
    await expect(sheet, 'the "Upload a save" sheet opens').toBeVisible();
    await sheet.getByTestId('bg3-upload-input').setInputFiles(file.path);
    const preview = sheet.getByTestId('bg3-upload-preview');
    await expect(preview, 'the browser parses the .lsv into a preview').toBeVisible({ timeout: UI_TIMEOUT });
    return preview;
}

/** Upload the picked save; returns the sheet once the result banner shows. */
async function submitUpload(page: Page): Promise<Locator> {
    const sheet = uploadSheet(page);
    const upload = sheet.getByRole('button', { name: 'Upload', exact: true });
    await expect(upload, 'Upload is enabled — the active campaign is preselected').toBeEnabled();
    await upload.click();
    return sheet;
}

async function closeWithDone(page: Page): Promise<void> {
    const sheet = uploadSheet(page);
    await sheet.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(sheet, 'Done closes the sheet').toHaveCount(0);
}

function partyList(page: Page): Locator {
    return page.getByRole('list', { name: 'Party', exact: true });
}

test.describe('BG3 upload a save (ROK-1960)', () => {
    test.beforeAll(async () => {
        tempDir = mkdtempSync(join(tmpdir(), 'rl-bg3-upload-'));
        await ensurePluginActive(await getAdminToken(), 'bg3');
    });

    test.afterAll(() => {
        if (tempDir !== null) rmSync(tempDir, { recursive: true, force: true });
        tempDir = null;
    });

    test('Party empty state → Upload a save → preview → Upload → the Party widget shows the party', async ({ page }, testInfo) => {
        const seed = await seedHub(testInfo);
        const file = uploadFile(testInfo);
        const uploadCalls = watchUploadCalls(page);
        const jwt = await signInOnboardedMember(page, seed.memberId);
        await page.goto(`/hubs/${seed.hubId}`);
        const empty = page.getByTestId('bg3-party-empty');
        await expect(empty, 'the campaign has no saves yet').toContainText(`No saves in ${CAMPAIGN_NAME} yet.`, { timeout: UI_TIMEOUT });
        await empty.getByRole('button', { name: 'Upload a save' }).click();

        const preview = await pickSave(page, file);
        await expect(preview, 'the preview names the save').toContainText(SAVE_NAME);
        await expect(preview, 'the preview shows the act and area').toContainText(WHERE_TEXT);
        await expect(preview.getByRole('listitem'), 'the preview lists the whole party').toHaveCount(PARTY_SIZE);
        expect(uploadCalls, 'parsing and previewing send nothing (no blob, bind or message)').toEqual([]);

        const sheet = await submitUpload(page);
        await expect(sheet.getByTestId('bg3-upload-banner-success'), 'the success banner names the campaign').toHaveText(
            `Uploaded to ${CAMPAIGN_NAME}`,
            { timeout: UI_TIMEOUT },
        );
        expectUploadCalls(uploadCalls, file);
        expect(await waitForParty(jwt, seed.hubId, PARTY_SIZE), 'the uploaded save is the 4-hero party').toBe(HERO_COUNT);
        await closeWithDone(page);

        await expect(partyList(page).getByTestId('bg3-party-slot'), 'one Party tile per hero').toHaveCount(HERO_COUNT, {
            timeout: UI_TIMEOUT,
        });
        await expect(page.getByTestId('bg3-party-summons'), 'the summon is listed apart from the heroes').toBeVisible();
        await expect(page.getByTestId('bg3-where-place'), 'Where we are shows the uploaded area').toHaveText(WHERE_TEXT, {
            timeout: UI_TIMEOUT,
        });
    });

    test('Campaign tab → Upload a save twice → the second says "Already uploaded."', async ({ page }, testInfo) => {
        const seed = await seedHub(testInfo);
        const file = uploadFile(testInfo);
        const jwt = await signInOnboardedMember(page, seed.memberId);
        await page.goto(`/hubs/${seed.hubId}#campaign`);
        const tab = page.getByTestId('bg3-campaign-tab');
        const openSheet = tab.getByRole('button', { name: 'Upload a save' });
        await expect(openSheet, 'a member sees Upload a save under Your saves').toBeVisible({ timeout: UI_TIMEOUT });

        await openSheet.click();
        await pickSave(page, file);
        await expect((await submitUpload(page)).getByTestId('bg3-upload-banner-success'), 'the first upload lands').toBeVisible({
            timeout: UI_TIMEOUT,
        });
        await waitForParty(jwt, seed.hubId, PARTY_SIZE);
        await closeWithDone(page);

        await openSheet.click();
        await pickSave(page, file);
        const sheet = await submitUpload(page);
        await expect(sheet.getByTestId('bg3-upload-banner-info'), 'the replay is reported, not filed twice').toHaveText('Already uploaded.', {
            timeout: UI_TIMEOUT,
        });
        await expect(sheet.getByTestId('bg3-upload-banner-success'), 'no success banner on a replay').toHaveCount(0);
        await closeWithDone(page);
    });
});
