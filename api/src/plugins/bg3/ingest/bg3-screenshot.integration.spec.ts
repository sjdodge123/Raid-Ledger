/**
 * ROK-1966 — `bg3-screenshot` v1 against a real DB, end to end through the
 * companion ingest path: a linked device PUTs the WebP blob, POSTs the
 * message, and the production `Bg3ScreenshotHandler` (registered by
 * `Bg3Module`, nothing stubbed) files it in the target hub's Gallery. Also
 * the Q3 refusals, the spoiler gate, the `/config` hub picker and
 * "Delete my BG3 data". Companion blobs and hub media each live in a
 * per-file tmpdir; every WebP is generated in-test with sharp.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import type { Response } from 'supertest';
import {
  BG3_GAME_SLUG,
  BG3_PLUGIN_ID,
  BG3_SCREENSHOT_CONTRACT_ID,
  Bg3ScreenshotMessageSchema,
  CompanionConfigSchema,
  CompanionIngestAckSchema,
  CompanionIngestErrorSchema,
  HubMediaListResponseSchema,
  type Bg3ScreenshotMessage,
  type CompanionWebpRef,
  type HubMediaListResponse,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import {
  bearer,
  expireLimiterWindows,
  linkDevice,
  makeUser,
} from '../../../companion/devices/testing/companion-link.helpers';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { screenshotStorageName } from './bg3-screenshot.repository';

interface Who {
  id: number;
  name: string;
  /** Session JWT (Gallery + me/data routes). */
  token: string;
  /** Linked device `rlcd_` token (companion routes). */
  device: string;
}
interface Shot {
  bytes: Buffer;
  ref: CompanionWebpRef;
}

const MESSAGES = `/companion/v1/messages/${BG3_SCREENSHOT_CONTRACT_ID}`;
const CONFIG = '/companion/v1/config';
const NO_STORE = 'private, no-store';
const FIXTURE = join(
  __dirname,
  '../../../../../packages/contract/companion/bg3-screenshot/v1/fixtures/steam-1080p.json',
);
const BASE: Bg3ScreenshotMessage = Bg3ScreenshotMessageSchema.parse(
  JSON.parse(readFileSync(FIXTURE, 'utf8')) as unknown,
);
/** Fixed and in the past: never trips the capturedAt future guard. */
const TAKEN = '2026-10-30T12:00:00Z';
const CAPTURED = '2026-10-30T12:00:05Z';
const NOT_A_MEMBER = [
  { path: 'payload.target.hubGuildId', code: 'not_a_member' },
];

let testApp: TestApp;
let blobRoot = '';
let mediaRoot = '';

const mediaRows = (guildId: number) =>
  testApp.db
    .select()
    .from(schema.hubMedia)
    .where(eq(schema.hubMedia.guildId, guildId));

async function gameId(slug: string, name: string): Promise<number> {
  const [found] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, slug));
  if (found) return found.id;
  const [game] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name, slug })
      .returning({ id: schema.games.id }),
    `game ${slug}`,
  );
  return game.id;
}

async function insertHub(
  name: string,
  slug: string = BG3_GAME_SLUG,
): Promise<number> {
  const [hub] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: await gameId(slug, slug === BG3_GAME_SLUG ? 'BG3' : slug),
        kind: 'game_community',
        region: 'community',
        source: 'community',
        name,
        nameKey: name.toLowerCase(),
        status: 'active',
      })
      .returning({ id: schema.guilds.id }),
    `hub ${name}`,
  );
  return hub.id;
}

async function joinHub(guildId: number, userId: number): Promise<void> {
  await testApp.db
    .insert(schema.hubCommunityMembers)
    .values({ guildId, userId, role: 'member' });
}

/** A member with a session JWT and a linked device. */
async function person(name: string): Promise<Who> {
  const user = await makeUser(testApp, name);
  const { token: device } = await linkDevice(testApp, user.token);
  return { id: user.id, name, token: user.token, device };
}

/** A tiny lossless WebP (distinct bytes per colour) and its ref. */
async function makeShot(red: number): Promise<Shot> {
  const create = {
    width: 64,
    height: 36,
    channels: 3,
    background: { r: red, g: 20, b: 30 },
  } as const;
  const bytes = await sharp({ create }).webp({ lossless: true }).toBuffer();
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const ref: CompanionWebpRef = {
    sha256,
    byteLength: bytes.length,
    contentType: 'image/webp',
    width: 64,
    height: 36,
  };
  return { bytes, ref };
}

/** PUT the blob with the device token; 201 stored. */
async function putBlob(who: Who, shot: Shot): Promise<void> {
  const res = await testApp.request
    .put(`/companion/v1/blobs/${shot.ref.sha256}`)
    .set('Content-Type', 'image/webp')
    .set(bearer(who.device))
    .serialize((b) => b)
    .send(shot.bytes);
  expect([res.status, res.body]).toEqual([
    201,
    { status: 'stored', sha256: shot.ref.sha256 },
  ]);
}

function message(shot: Shot, hubGuildId: number): Bg3ScreenshotMessage {
  return {
    ...BASE,
    capturedAt: CAPTURED,
    payload: {
      ...BASE.payload,
      takenAt: TAKEN,
      image: shot.ref,
      target: { hubGuildId },
    },
  };
}

function post(who: Who, msg: Bg3ScreenshotMessage) {
  return (
    testApp.request
      .post(MESSAGES)
      .set('Content-Type', 'application/json')
      .set(bearer(who.device))
      // superagent would JSON-serialise a Buffer itself; send the bytes as-is.
      .serialize((bytes) => bytes)
      .send(Buffer.from(JSON.stringify(msg)))
  );
}

/** Blob PUT + message POST for `hubGuildId`; returns the POST response. */
async function upload(
  who: Who,
  shot: Shot,
  hubGuildId: number,
): Promise<Response> {
  await putBlob(who, shot);
  return post(who, message(shot, hubGuildId));
}

function expectAck(res: Response, status: 'accepted' | 'stale'): void {
  expect([res.status, res.body]).toEqual([202, { status }]);
  expect(CompanionIngestAckSchema.safeParse(res.body).success).toBe(true);
}

function expectNotAMember(res: Response): void {
  const body = CompanionIngestErrorSchema.parse(res.body);
  expect([res.status, body.code, body.issues]).toEqual([
    400,
    'invalid_payload',
    NOT_A_MEMBER,
  ]);
}

async function gallery(hubId: number, who: Who): Promise<HubMediaListResponse> {
  const res = await testApp.request
    .get(`/hubs/${hubId}/media`)
    .set(bearer(who.token));
  expect([res.status, res.headers['cache-control']]).toEqual([200, NO_STORE]);
  return HubMediaListResponseSchema.parse(res.body);
}

async function setSpoilerToggle(guildId: number, hide: boolean) {
  await testApp.db
    .insert(schema.bg3HubSettings)
    .values({ guildId, hideLocationAndScreenshots: hide })
    .onConflictDoUpdate({
      target: schema.bg3HubSettings.guildId,
      set: { hideLocationAndScreenshots: hide },
    });
}

/** One save by `userId` filed under a campaign of `guildId`, at `savedAt`. */
async function saveIn(guildId: number, userId: number, savedAt: string) {
  const [camp] = nonEmpty(
    await testApp.db
      .insert(schema.bg3Campaigns)
      .values({ guildId, name: `Camp ${guildId}`, hostUserId: userId })
      .returning({ id: schema.bg3Campaigns.id }),
    'campaign',
  );
  const at = new Date(savedAt);
  await testApp.db.insert(schema.bg3Saves).values({
    uploaderUserId: userId,
    campaignId: camp.id,
    campaignKey: 'd'.repeat(64),
    campaignKeySource: 'save-folder',
    saveName: 'Quicksave',
    savedAt: at,
    capturedAt: at,
    gameVersion: '4.1.1.7631656',
    platform: 'Steam',
    currentLevel: 'SCL_Main_A',
    difficulty: 'DifficultyHard',
    ruleset: 'RulesetLarian',
    party: [],
    partyMaxLevel: 8,
  });
}

async function hubTargetsFor(who: Who) {
  const res = await testApp.request.get(CONFIG).set(bearer(who.device));
  expect(res.status).toBe(200);
  const config = CompanionConfigSchema.parse(res.body);
  const entry = config.contracts?.find(
    (c) => c.id === BG3_SCREENSHOT_CONTRACT_ID,
  );
  expect(entry?.enabled).toBe(true);
  return entry?.hubTargets;
}

/** Every file under the hub-media root, sorted (a replay must write none). */
const mediaFiles = (): string[] =>
  readdirSync(mediaRoot, { recursive: true, encoding: 'utf8' }).sort();

function emptyDir(dir: string): void {
  for (const name of readdirSync(dir))
    rmSync(join(dir, name), { recursive: true, force: true });
}

beforeAll(async () => {
  blobRoot = mkdtempSync(join(tmpdir(), 'rl-bg3-shot-blobs-'));
  mediaRoot = mkdtempSync(join(tmpdir(), 'rl-bg3-shot-media-'));
  process.env.COMPANION_BLOB_DIR = blobRoot;
  process.env.HUB_MEDIA_DIR = mediaRoot;
  testApp = await getTestApp();
});

// No afterAll DB work: the shared integration-setup afterAll closes the pool.
afterAll(() => {
  delete process.env.COMPANION_BLOB_DIR;
  delete process.env.HUB_MEDIA_DIR;
  rmSync(blobRoot, { recursive: true, force: true });
  rmSync(mediaRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  // Ids repeat after a truncate: start every case with empty roots.
  emptyDir(blobRoot);
  emptyDir(mediaRoot);
  expireLimiterWindows(testApp);
  // The truncate resets plugins; the bg3 gate fails closed while bg3 is off.
  const plugins = testApp.app.get(PluginRegistryService);
  await plugins.ensureInstalled(BG3_PLUGIN_ID);
  await plugins.activate(BG3_PLUGIN_ID);
});

describe('ingest → hub Gallery', () => {
  it('S-1 a device upload lands as one bg3-screenshot row, listed and served from the Gallery', async () => {
    const hub = await insertHub('Tav Party');
    const tav = await person('tav');
    const mate = await person('mate');
    await joinHub(hub, tav.id);
    await joinHub(hub, mate.id);
    const shot = await makeShot(40);
    expectAck(await upload(tav, shot, hub), 'accepted');

    const [row, ...rest] = await mediaRows(hub);
    expect(rest).toEqual([]);
    // Review P2: the Gallery keeps its own copy, so the raw blob's ref is
    // released in the ingest tx and the blob no longer pins tav's quota.
    const refs = await testApp.db
      .select({ contract: schema.companionBlobRefs.contract })
      .from(schema.companionBlobRefs)
      .where(eq(schema.companionBlobRefs.userId, tav.id));
    expect(refs).toEqual([]);
    expect({
      source: row?.source,
      kind: row?.kind,
      provenanceKey: row?.provenanceKey,
      uploadedBy: row?.uploadedBy,
      authorName: row?.authorName,
      capturedAt: row?.capturedAt.toISOString(),
      removedAt: row?.removedAt,
    }).toEqual({
      source: 'bg3-screenshot',
      kind: 'screenshot',
      provenanceKey: `bg3-screenshot:sha256:${shot.ref.sha256}`,
      uploadedBy: tav.id,
      authorName: 'tav',
      capturedAt: new Date(TAKEN).toISOString(),
      removedAt: null,
    });
    const list = await gallery(hub, mate);
    expect(
      list.items.map((i) => [i.id, i.kind, i.source.type, i.authorName]),
    ).toEqual([[row?.id, 'screenshot', 'bg3-screenshot', 'tav']]);
    const full = await testApp.request
      .get(`/hubs/${hub}/media/${row?.id}/full`)
      .set(bearer(mate.token));
    expect([full.status, full.headers['content-type']]).toEqual([
      200,
      'image/webp',
    ]);
  });

  it('S-2 a replay of the same WebP acks stale and stores nothing new', async () => {
    const hub = await insertHub('Tav Party');
    const tav = await person('tav');
    await joinHub(hub, tav.id);
    const shot = await makeShot(41);
    expectAck(await upload(tav, shot, hub), 'accepted');
    const before = (await mediaRows(hub)).map((r) => r.id);
    expect(before).toHaveLength(1);
    const filesBefore = mediaFiles();

    expectAck(await post(tav, message(shot, hub)), 'stale');
    expect((await mediaRows(hub)).map((r) => r.id)).toEqual(before);
    expect(mediaFiles()).toEqual(filesBefore);
  });
});

describe('Q3 refusals', () => {
  it('S-3 a BG3 hub the uploader is not a member of → 400 invalid_payload not_a_member; no row', async () => {
    const hub = await insertHub('Tav Party');
    const outsider = await person('outsider');
    expectNotAMember(await upload(outsider, await makeShot(42), hub));
    expect(await mediaRows(hub)).toEqual([]);
  });

  it('S-4 a non-BG3 hub (even as a member) → 400 invalid_payload not_a_member; no row', async () => {
    const hub = await insertHub('Vikings', 'valheim');
    const tav = await person('tav');
    await joinHub(hub, tav.id);
    expectNotAMember(await upload(tav, await makeShot(43), hub));
    expect(await mediaRows(hub)).toEqual([]);
  });
});

describe('spoiler gate', () => {
  it('S-5 hideLocationAndScreenshots on → stored but hidden from the Gallery; off → listed', async () => {
    const hub = await insertHub('Tav Party');
    const tav = await person('tav');
    const mate = await person('mate');
    await joinHub(hub, tav.id);
    await joinHub(hub, mate.id);
    await setSpoilerToggle(hub, true);
    expectAck(await upload(tav, await makeShot(44), hub), 'accepted');

    const [row] = await mediaRows(hub);
    expect(row?.source).toBe('bg3-screenshot');
    const hidden = await gallery(hub, mate);
    expect([hidden.items, hidden.total]).toEqual([[], 0]);

    await setSpoilerToggle(hub, false);
    const shown = await gallery(hub, mate);
    expect(shown.items.map((i) => i.id)).toEqual([row?.id]);
  });
});

describe('/config hub picker', () => {
  it('S-6 lists only live BG3 hubs; default = first by name, then the hub of the latest save', async () => {
    const tav = await person('tav');
    const bravo = await insertHub('Bravo');
    const alpha = await insertHub('Alpha');
    const vikings = await insertHub('Vikings', 'valheim');
    const notJoined = await insertHub('Charlie');
    await joinHub(bravo, tav.id);
    await joinHub(alpha, tav.id);
    await joinHub(vikings, tav.id);
    expect(notJoined).toBeGreaterThan(0);

    expect(await hubTargetsFor(tav)).toEqual([
      { hubGuildId: alpha, name: 'Alpha', isDefault: true },
      { hubGuildId: bravo, name: 'Bravo', isDefault: false },
    ]);

    await saveIn(alpha, tav.id, '2026-10-20T10:00:00Z');
    await saveIn(bravo, tav.id, '2026-10-21T10:00:00Z');
    expect(await hubTargetsFor(tav)).toEqual([
      { hubGuildId: alpha, name: 'Alpha', isDefault: false },
      { hubGuildId: bravo, name: 'Bravo', isDefault: true },
    ]);
  });

  it('S-6b a user in no BG3 hub gets an empty picker', async () => {
    const loner = await person('loner');
    expect(await hubTargetsFor(loner)).toEqual([]);
  });
});

describe('Delete my BG3 data', () => {
  it("S-7 tombstones the caller's screenshots only; another member's stays listed", async () => {
    const hub = await insertHub('Tav Party');
    const tav = await person('tav');
    const mate = await person('mate');
    await joinHub(hub, tav.id);
    await joinHub(hub, mate.id);
    expectAck(await upload(tav, await makeShot(45), hub), 'accepted');
    expectAck(await upload(mate, await makeShot(46), hub), 'accepted');
    const byUploader = async () =>
      Object.fromEntries(
        (await mediaRows(hub)).map((r) => [r.uploadedBy, r.removedAt]),
      );
    const mateRow = (await mediaRows(hub)).find(
      (r) => r.uploadedBy === mate.id,
    );

    const res = await testApp.request
      .delete('/plugins/bg3/me/data')
      .set(bearer(tav.token));
    expect(res.status).toBe(200);

    const removed = await byUploader();
    expect([removed[tav.id] instanceof Date, removed[mate.id]]).toEqual([
      true,
      null,
    ]);
    expect((await gallery(hub, mate)).items.map((i) => i.id)).toEqual([
      mateRow?.id,
    ]);
  });
});

describe('per-user hourly allowance (review M1)', () => {
  afterEach(() => {
    delete process.env.HUB_MEDIA_COMPANION_PER_HOUR;
  });

  it('S-8 past the allowance → 429 rate_limited and no row; a replay still acks stale; another member is unaffected', async () => {
    process.env.HUB_MEDIA_COMPANION_PER_HOUR = '2';
    const hub = await insertHub('Tav Party');
    const tav = await person('tav');
    const mate = await person('mate');
    await joinHub(hub, tav.id);
    await joinHub(hub, mate.id);
    const first = await makeShot(50);
    expectAck(await upload(tav, first, hub), 'accepted');
    expectAck(await upload(tav, await makeShot(51), hub), 'accepted');

    const third = await upload(tav, await makeShot(52), hub);
    const body = CompanionIngestErrorSchema.parse(third.body);
    expect([third.status, body.code]).toEqual([429, 'rate_limited']);
    expect(await mediaRows(hub)).toHaveLength(2);

    // A replay acks stale before `handle`, so it never spends a slot.
    expectAck(await post(tav, message(first, hub)), 'stale');
    expectAck(await upload(mate, await makeShot(53), hub), 'accepted');
    expect(await mediaRows(hub)).toHaveLength(3);
  });

  it('S-9 a stored screenshot is written under its content-addressed name', async () => {
    const hub = await insertHub('Tav Party');
    const tav = await person('tav');
    await joinHub(hub, tav.id);
    const shot = await makeShot(54);
    expectAck(await upload(tav, shot, hub), 'accepted');
    const name = screenshotStorageName(shot.ref.sha256);
    const [row] = await mediaRows(hub);
    expect(row?.storageName).toBe(name);
    expect(mediaFiles()).toEqual(
      [`${hub}`, `${hub}/${name}.thumb.webp`, `${hub}/${name}.webp`].sort(),
    );
  });
});
