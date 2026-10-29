/**
 * ROK-1959 §7 G-1..G-11 — BG3 save pictures copied into the hub Gallery,
 * against a real DB: the sync (closed sessions only, provenance, tombstones,
 * missing blobs, the hub cap), the bg3 media gate (spoiler toggle, plugin
 * off), Remove rights and delete-my-data. Companion blobs and hub media each
 * live in a per-file tmpdir; every WebP is generated in-test with sharp.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import type { Response } from 'superagent';
import {
  BG3_GAME_SLUG,
  BG3_PLUGIN_ID,
  HubMediaListResponseSchema,
  type HubMediaListResponse,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { signTestAccessToken } from '../../../common/testing/sign-test-access-token';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { HUB_NOT_FOUND } from '../../../guilds/hub-hidden.helpers';
import { mediaFilePath } from '../../../hub-media/hub-media.paths';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { Bg3GallerySyncCron } from './bg3-gallery-sync.cron';
import { Bg3GallerySyncService } from './bg3-gallery-sync.service';

interface Who {
  id: number;
  token: string;
}
const HOUR = 3_600_000;
const KEY = 'c'.repeat(64);
const NO_STORE = 'private, no-store';

let testApp: TestApp;
let blobRoot = '';
let mediaRoot = '';
let leader: Who; // community leader (editor + Remove any)
let uploader: Who; // member whose saves are copied
let member: Who; // plain member, not the uploader
let outsider: Who; // signed in, not a member
let hub: number;
let camp: number;
let now: Date;

const auth = (w: Who) => ({ Authorization: `Bearer ${w.token}` });
const base = () => `/hubs/${hub}/media`;
const get = (url: string, w: Who) => testApp.request.get(url).set(auth(w));
const sync = () => testApp.app.get(Bg3GallerySyncService).runOnce(now);
const ago = (hours: number) => new Date(now.getTime() - hours * HOUR);

async function makeUser(name: string): Promise<Who> {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${name}`, username: name, role: 'member' })
      .returning({ id: schema.users.id }),
    `user ${name}`,
  );
  const claims = { sub: u.id, username: name, role: 'member' as const };
  return { id: u.id, token: await signTestAccessToken(testApp, claims) };
}

async function makeHub(): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'BG3', slug: BG3_GAME_SLUG })
      .returning({ id: schema.games.id }),
    'game',
  );
  const [h] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: g.id,
        kind: 'game_community',
        region: 'community',
        source: 'community',
        name: 'Tav Party',
        nameKey: 'tav party',
        status: 'active',
      })
      .returning({ id: schema.guilds.id }),
    'hub',
  );
  return h.id;
}

async function join_(userId: number, role: 'leader' | 'member') {
  await testApp.db
    .insert(schema.hubCommunityMembers)
    .values({ guildId: hub, userId, role });
}

/** A tiny still WebP; lossless keeps the bytes (and sha) distinct per colour. */
const makeWebp = (red: number): Promise<Buffer> =>
  sharp({
    create: {
      width: 64,
      height: 36,
      channels: 3,
      background: { r: red, g: 20, b: 30 },
    },
  })
    .webp({ lossless: true })
    .toBuffer();

const blobPath = (userId: number, sha: string) =>
  join(blobRoot, String(userId), `${sha}.webp`);

/** `userId`'s companion blob (row + file); returns the sha. */
async function storeBlob(userId: number, red: number): Promise<string> {
  const bytes = await makeWebp(red);
  const sha = createHash('sha256').update(bytes).digest('hex');
  mkdirSync(join(blobRoot, String(userId)), { recursive: true });
  writeFileSync(blobPath(userId, sha), bytes);
  await testApp.db.insert(schema.companionBlobs).values({
    userId,
    sha256: sha,
    byteLength: bytes.length,
    width: 64,
    height: 36,
    storagePath: `${userId}/${sha}.webp`,
  });
  return sha;
}

/** One pictured save by the uploader in `camp`, `hoursAgo` before `now`. */
async function pictured(hoursAgo: number, red: number) {
  const sha = await storeBlob(uploader.id, red);
  const savedAt = ago(hoursAgo);
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.bg3Saves)
      .values({
        uploaderUserId: uploader.id,
        campaignId: camp,
        campaignKey: KEY,
        campaignKeySource: 'save-folder',
        saveName: `Save ${red}`,
        savedAt,
        capturedAt: savedAt,
        gameVersion: '4.1.1.7631656',
        platform: 'Steam',
        currentLevel: 'SCL_Main_A',
        difficulty: 'DifficultyHard',
        ruleset: 'RulesetLarian',
        party: [],
        partyMaxLevel: 8,
        thumbnailSha256: sha,
      })
      .returning({ id: schema.bg3Saves.id }),
    'save',
  );
  return { saveId: row.id, sha, savedAt };
}

const mediaRows = () =>
  testApp.db
    .select()
    .from(schema.hubMedia)
    .where(eq(schema.hubMedia.guildId, hub));

async function onlyRow() {
  const rows = await mediaRows();
  expect(rows).toHaveLength(1);
  return nonEmpty(rows, 'hub_media row')[0];
}

async function listOf(w: Who, qs = ''): Promise<HubMediaListResponse> {
  const res = await get(`${base()}${qs}`, w);
  expect([res.status, res.headers['cache-control']]).toEqual([200, NO_STORE]);
  return HubMediaListResponseSchema.parse(res.body);
}
const shape = (r: HubMediaListResponse) => ({
  ids: r.items.map((i) => i.id),
  total: r.total,
  kinds: r.kinds,
});

async function setSpoilerToggle(hide: boolean): Promise<void> {
  await testApp.db
    .insert(schema.bg3HubSettings)
    .values({ guildId: hub, hideLocationAndScreenshots: hide })
    .onConflictDoUpdate({
      target: schema.bg3HubSettings.guildId,
      set: { hideLocationAndScreenshots: hide },
    });
}

/** Raw bytes, so webp and JSON errors read the same way. */
function binary(res: Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}
const getBytes = (url: string, w: Who) =>
  get(url, w).buffer(true).parse(binary);

/** A Discord screenshot row inserted directly (the list needs no file). */
async function discordShot(hoursAgo: number): Promise<number> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.hubMedia)
      .values({
        guildId: hub,
        source: 'discord',
        kind: 'screenshot',
        provenanceKey: `discord:shot:${hoursAgo}`,
        authorName: 'Ragnar',
        caption: 'shot',
        capturedAt: ago(hoursAgo),
        storageName: '00000000-0000-4000-8000-000000000001',
        width: 10,
        height: 10,
        bytes: 1,
      })
      .returning({ id: schema.hubMedia.id }),
    'discord row',
  );
  return row.id;
}

function emptyDir(dir: string): void {
  for (const name of readdirSync(dir))
    rmSync(join(dir, name), { recursive: true, force: true });
}

beforeAll(async () => {
  blobRoot = mkdtempSync(join(tmpdir(), 'rl-bg3-gallery-blobs-'));
  mediaRoot = mkdtempSync(join(tmpdir(), 'rl-bg3-gallery-media-'));
  process.env.COMPANION_BLOB_DIR = blobRoot;
  process.env.HUB_MEDIA_DIR = mediaRoot;
  testApp = await getTestApp();
});

afterAll(() => {
  delete process.env.COMPANION_BLOB_DIR;
  delete process.env.HUB_MEDIA_DIR;
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  // Ids repeat after a truncate: start every case with empty roots.
  emptyDir(blobRoot);
  emptyDir(mediaRoot);
  // The truncate resets plugins; the bg3 gate fails closed while bg3 is off.
  const plugins = testApp.app.get(PluginRegistryService);
  await plugins.ensureInstalled(BG3_PLUGIN_ID);
  await plugins.activate(BG3_PLUGIN_ID);
  now = new Date();
  hub = await makeHub();
  leader = await makeUser('leader');
  uploader = await makeUser('uploader');
  member = await makeUser('member');
  outsider = await makeUser('outsider');
  await join_(leader.id, 'leader');
  await join_(uploader.id, 'member');
  await join_(member.id, 'member');
  const [c] = nonEmpty(
    await testApp.db
      .insert(schema.bg3Campaigns)
      .values({ guildId: hub, name: 'Act 2', hostUserId: uploader.id })
      .returning({ id: schema.bg3Campaigns.id }),
    'campaign',
  );
  camp = c.id;
});

describe('sync (G-1, G-2, G-8, G-9)', () => {
  it('G-1 a closed session becomes exactly one save row, served as WebP; a second run adds nothing', async () => {
    const { sha, savedAt } = await pictured(5, 40);
    expect(await sync()).toEqual({ stored: 1, skipped: 0, failedHubs: 0 });
    const row = await onlyRow();
    expect({
      source: row.source,
      kind: row.kind,
      provenanceKey: row.provenanceKey,
      uploadedBy: row.uploadedBy,
      capturedAt: row.capturedAt.toISOString(),
      removedAt: row.removedAt,
    }).toEqual({
      source: 'bg3-save',
      kind: 'save',
      provenanceKey: `bg3-save:sha256:${sha}`,
      uploadedBy: uploader.id,
      capturedAt: savedAt.toISOString(),
      removedAt: null,
    });
    const res = await getBytes(`${base()}/${row.id}/full`, member);
    expect([res.status, res.headers['content-type']]).toEqual([
      200,
      'image/webp',
    ]);
    const body: unknown = res.body;
    if (!Buffer.isBuffer(body)) throw new Error('expected a byte body');
    expect((await sharp(body).metadata()).format).toBe('webp');
    expect(await sync()).toEqual({ stored: 0, skipped: 0, failedHubs: 0 });
    expect((await mediaRows()).map((r) => r.id)).toEqual([row.id]);
  });

  it('G-2 a session still open (last save under 4 h ago) is not copied yet', async () => {
    await pictured(1, 41);
    expect(await sync()).toEqual({ stored: 0, skipped: 0, failedHubs: 0 });
    expect(await mediaRows()).toEqual([]);
  });

  it('G-8 a deleted blob file is skipped without throwing', async () => {
    const { sha } = await pictured(5, 42);
    rmSync(blobPath(uploader.id, sha));
    expect(await sync()).toEqual({ stored: 0, skipped: 1, failedHubs: 0 });
    expect(await mediaRows()).toEqual([]);
  });

  it('G-9 a full hub (tiny HUB_MEDIA_MAX_BYTES_PER_HUB) stores nothing and does not fail the run', async () => {
    await pictured(5, 43);
    process.env.HUB_MEDIA_MAX_BYTES_PER_HUB = '1';
    try {
      expect(await sync()).toEqual({ stored: 0, skipped: 0, failedHubs: 0 });
    } finally {
      delete process.env.HUB_MEDIA_MAX_BYTES_PER_HUB;
    }
    expect(await mediaRows()).toEqual([]);
  });
});

describe('media gate (G-3, G-4)', () => {
  it('G-3 the spoiler toggle hides saves from list, total, kinds, item and bytes — for an editor too — and off shows them again', async () => {
    const shot = await discordShot(2);
    await pictured(5, 50);
    await sync();
    const saveId = (await mediaRows()).find((r) => r.kind === 'save')?.id;
    if (saveId === undefined) throw new Error('save row not copied');
    const open = {
      ids: [shot, saveId],
      total: 2,
      kinds: ['screenshot', 'save'],
    };
    expect(shape(await listOf(leader))).toEqual(open);
    await setSpoilerToggle(true);
    const gated = { ids: [shot], total: 1, kinds: ['screenshot'] };
    expect(shape(await listOf(leader))).toEqual(gated);
    expect(shape(await listOf(member))).toEqual(gated);
    const statuses = await Promise.all(
      [`${base()}/${saveId}`, `${base()}/${saveId}/full`].map(
        async (url) => (await get(url, leader)).status,
      ),
    );
    expect(statuses).toEqual([404, 404]);
    await setSpoilerToggle(false);
    expect(shape(await listOf(leader))).toEqual(open);
    expect((await get(`${base()}/${saveId}`, leader)).status).toBe(200);
  });

  it('G-4 bg3 inactive: the cron is a no-op and copied saves are hidden (fail closed)', async () => {
    await pictured(10, 51);
    await sync();
    const [copied] = nonEmpty(await mediaRows(), 'copied row');
    await pictured(5, 52); // a second closed session, still to copy
    await testApp.app.get(PluginRegistryService).deactivate(BG3_PLUGIN_ID);
    await testApp.app.get(Bg3GallerySyncCron).run();
    expect((await mediaRows()).map((r) => r.id)).toEqual([copied.id]);
    expect(shape(await listOf(member))).toEqual({
      ids: [],
      total: 0,
      kinds: [],
    });
    expect((await get(`${base()}/${copied.id}`, leader)).status).toBe(404);
  });
});

describe('Remove + rights (G-5, G-6, G-7)', () => {
  it('G-5 a picture the leader Removes is tombstoned and the next run does not plan it again', async () => {
    await pictured(5, 60);
    await sync();
    const row = await onlyRow();
    const del = await testApp.request
      .delete(`${base()}/${row.id}`)
      .set(auth(leader));
    expect(del.status).toBe(204);
    expect((await onlyRow()).removedAt).toBeInstanceOf(Date);
    // skipped: 0 proves the tombstone kept the pick out of the plan.
    expect(await sync()).toEqual({ stored: 0, skipped: 0, failedHubs: 0 });
    const after = await onlyRow();
    expect([after.id, after.removedAt === null]).toEqual([row.id, false]);
    expect(shape(await listOf(leader)).total).toBe(0);
  });

  it('G-6 the uploader may Remove their save; another member may not', async () => {
    await pictured(5, 61);
    await sync();
    const rights = async (w: Who) =>
      (await listOf(w)).items.map((i) => i.canRemove);
    expect({
      uploader: await rights(uploader),
      member: await rights(member),
    }).toEqual({ uploader: [true], member: [false] });
  });

  it('G-7 delete-my-data tombstones the uploader’s gallery rows and unlinks their files', async () => {
    await pictured(10, 62);
    await pictured(5, 63);
    expect((await sync()).stored).toBe(2);
    const before = await mediaRows();
    const files = before.flatMap((r) =>
      (['full', 'thumb'] as const).map((v) =>
        mediaFilePath(hub, r.storageName, v),
      ),
    );
    expect(files.map((f) => existsSync(f))).toEqual(files.map(() => true));
    const res = await testApp.request
      .delete('/plugins/bg3/me/data')
      .set(auth(uploader));
    expect(res.status).toBe(200);
    const after = await mediaRows();
    expect(after.map((r) => r.removedAt instanceof Date)).toEqual([true, true]);
    expect(files.map((f) => existsSync(f))).toEqual(files.map(() => false));
  });
});

describe('reads (G-10, G-11)', () => {
  it('G-10 ?kind=save lists only save rows; kinds still names both', async () => {
    await discordShot(2);
    await pictured(5, 70);
    await sync();
    const save = (await listOf(member, '?kind=save')).items;
    expect(save.map((i) => [i.kind, i.source.type])).toEqual([
      ['save', 'bg3-save'],
    ]);
    expect((await listOf(member, '?kind=save')).kinds).toEqual([
      'screenshot',
      'save',
    ]);
  });

  it('G-11 a non-member gets the hub 404 for list, item and bytes', async () => {
    await pictured(5, 71);
    await sync();
    const row = await onlyRow();
    const res = await Promise.all(
      [base(), `${base()}/${row.id}`, `${base()}/${row.id}/full`].map(
        async (url) => {
          const r = await get(url, outsider);
          return [r.status, (r.body as { message?: unknown }).message];
        },
      ),
    );
    expect(res).toEqual([
      [404, HUB_NOT_FOUND],
      [404, HUB_NOT_FOUND],
      [404, HUB_NOT_FOUND],
    ]);
  });
});
