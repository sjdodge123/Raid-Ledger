/**
 * ROK-1957 L8b2 — BG3 pictures + the caller's own saves against a real DB
 * (§5.4, §5.6, §5.7, §9.2): D-12 re-encoded thumbnail bytes, the D-14
 * spoiler toggle, the settings write, `me/saves` paging and the ROK-1959
 * gallery feed. Blobs live in a per-file tmpdir (`COMPANION_BLOB_DIR`);
 * every WebP is generated in-test with sharp.
 */
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
  Bg3MySavesResponseSchema,
  Bg3SaveMessageSchema,
  Bg3SessionsResponseSchema,
  Bg3SnapshotResponseSchema,
  type Bg3PartyMember,
  type UserRole,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { signTestAccessToken } from '../../../common/testing/sign-test-access-token';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { Bg3GalleryFeed } from '../bg3-gallery.feed';

const PARTY: Bg3PartyMember[] = Bg3SaveMessageSchema.parse(
  JSON.parse(
    readFileSync(
      join(
        __dirname,
        '../../../../../packages/contract/companion/bg3-save/v1/fixtures/act2-party-4p-summon.json',
      ),
      'utf8',
    ),
  ) as unknown,
).payload.party;
const KEY = 'a'.repeat(64);

interface Who {
  id: number;
  token: string;
}
let testApp: TestApp;
let host: Who; // member, campaign host
let guest: Who; // member, not host, the uploader in most cases
let officer: Who; // hub editor
let admin: Who; // staff, not a member
let hub: number;
let otherHub: number; // a second BG3 hub
let camp: number;
let foreignCamp: number; // belongs to otherHub

const auth = (w: Who) => ({ Authorization: `Bearer ${w.token}` });
const base = (h: number) => `/plugins/bg3/hubs/${h}`;

async function makeUser(name: string, role: UserRole = 'member') {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${name}`, username: name, role })
      .returning({ id: schema.users.id }),
    `user ${name}`,
  );
  const claims = { sub: u.id, username: name, role };
  return { id: u.id, token: await signTestAccessToken(testApp, claims) };
}

async function makeGame(slug: string): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: slug, slug })
      .returning({ id: schema.games.id }),
    `game ${slug}`,
  );
  return g.id;
}

async function makeHub(gameId: number, name: string): Promise<number> {
  const [h] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId,
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
  return h.id;
}

async function joinHub(
  guildId: number,
  userId: number,
  role: 'member' | 'officer' = 'member',
) {
  await testApp.db
    .insert(schema.hubCommunityMembers)
    .values({ guildId, userId, role });
}

async function makeCampaign(guildId: number, hostUserId: number | null) {
  const [c] = nonEmpty(
    await testApp.db
      .insert(schema.bg3Campaigns)
      .values({ guildId, name: `Campaign ${guildId}`, hostUserId })
      .returning({ id: schema.bg3Campaigns.id }),
    'campaign',
  );
  return c.id;
}

interface SaveOpts {
  uploader: number;
  campaignId: number | null;
  savedAt: string;
  area?: string;
  level?: number;
  first?: string;
  count?: number;
  sha?: string;
}

async function save(o: SaveOpts): Promise<number> {
  const at = new Date(o.savedAt);
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.bg3Saves)
      .values({
        uploaderUserId: o.uploader,
        campaignId: o.campaignId,
        campaignKey: KEY,
        campaignKeySource: 'save-folder',
        saveName: `Save ${o.savedAt}`,
        savedAt: at,
        capturedAt: at,
        gameVersion: '4.1.1.7631656',
        platform: 'Steam',
        currentLevel: o.area ?? 'SCL_Main_A',
        difficulty: 'DifficultyHard',
        ruleset: 'RulesetLarian',
        party: PARTY,
        partyMaxLevel: o.level ?? 8,
        sessionFirstSavedAt: o.first ? new Date(o.first) : null,
        sessionSaveCount: o.count ?? null,
        thumbnailSha256: o.sha ?? null,
      })
      .returning({ id: schema.bg3Saves.id }),
    'save',
  );
  return row.id;
}

/** `[status, message]` of an error response. */
const said = (res: { status: number; body: unknown }): [number, unknown] => [
  res.status,
  (res.body as { message?: unknown }).message,
];

const get = (url: string, who: Who) => testApp.request.get(url).set(auth(who));

const putSettings = (h: number, who: Who, body: object) =>
  testApp.request
    .put(`${base(h)}/settings`)
    .send(body)
    .set(auth(who));

let root = '';
const priorDir = process.env.COMPANION_BLOB_DIR;
const THUMB_404 = [404, 'Thumbnail not found'];
const NO_STORE = 'private, no-store';

/** A tiny still WebP; lossless keeps the bytes deterministic per colour. */
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

/** Store `bytes` as `userId`'s companion blob (row + file); returns the sha. */
async function storeBlob(userId: number, bytes: Buffer): Promise<string> {
  const sha = createHash('sha256').update(bytes).digest('hex');
  mkdirSync(join(root, String(userId)), { recursive: true });
  writeFileSync(join(root, String(userId), `${sha}.webp`), bytes);
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

/** Raw bytes for every response, so webp and JSON errors read the same way. */
function binary(res: Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}
const getBytes = (url: string, who: Who) =>
  get(url, who).buffer(true).parse(binary);
const thumbUrl = (h: number, saveId: number, q = '') =>
  `${base(h)}/saves/${saveId}/thumbnail${q}`;
const ownUrl = (saveId: number) => `/plugins/bg3/me/saves/${saveId}/thumbnail`;

/** `[status, message]` of a binary-parsed error response. */
function failed(res: { status: number; body: unknown }): [number, unknown] {
  const raw = Buffer.isBuffer(res.body) ? res.body.toString('utf8') : '{}';
  return [res.status, (JSON.parse(raw) as { message?: unknown }).message];
}

/** 200, webp, never cached; returns the decoded dimensions. */
async function served(url: string, who: Who) {
  const res = await getBytes(url, who);
  expect([
    res.status,
    res.headers['content-type'],
    res.headers['cache-control'],
  ]).toEqual([200, 'image/webp', NO_STORE]);
  const body: unknown = res.body;
  if (!Buffer.isBuffer(body)) throw new Error('expected a byte body');
  const meta = await sharp(body).metadata();
  return { format: meta.format, width: meta.width, height: meta.height };
}

/** A guest save in `camp` with a stored picture. */
async function pictured(
  red = 10,
  uploader = guest,
  savedAt = '2026-10-24T12:00:00.000Z',
) {
  const sha = await storeBlob(uploader.id, await makeWebp(red));
  const id = await save({
    uploader: uploader.id,
    campaignId: camp,
    savedAt,
    sha,
  });
  return { id, sha };
}

async function hideSpoilers(): Promise<void> {
  await testApp.db
    .insert(schema.bg3HubSettings)
    .values({ guildId: hub, hideLocationAndScreenshots: true });
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'rl-bg3-read-'));
  process.env.COMPANION_BLOB_DIR = root;
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  // User ids repeat after a truncate: start every case with an empty root.
  for (const name of readdirSync(root))
    rmSync(join(root, name), { recursive: true, force: true });
  const plugins = testApp.app.get(PluginRegistryService);
  await plugins.ensureInstalled(BG3_PLUGIN_ID);
  await plugins.activate(BG3_PLUGIN_ID);
  const bg3 = await makeGame(BG3_GAME_SLUG);
  hub = await makeHub(bg3, 'Tav Crew');
  otherHub = await makeHub(bg3, 'Other Crew');
  host = await makeUser('host');
  guest = await makeUser('guest');
  officer = await makeUser('officer');
  admin = await makeUser('staff', 'admin');
  for (const u of [host, guest]) await joinHub(hub, u.id);
  await joinHub(hub, officer.id, 'officer');
  await joinHub(otherHub, guest.id);
  camp = await makeCampaign(hub, host.id);
  foreignCamp = await makeCampaign(otherHub, host.id);
});

afterAll(() => {
  if (priorDir === undefined) delete process.env.COMPANION_BLOB_DIR;
  else process.env.COMPANION_BLOB_DIR = priorDir;
  rmSync(root, { recursive: true, force: true });
});

describe('GET hubs/:hubId/saves/:saveId/thumbnail (D-12)', () => {
  it('serves re-encoded webp bytes, never cached; ?size=thumb is the 480 crop', async () => {
    const { id } = await pictured();
    expect(await served(thumbUrl(hub, id), host)).toEqual({
      format: 'webp',
      width: 64,
      height: 36,
    });
    expect(await served(thumbUrl(hub, id, '?size=thumb'), host)).toEqual({
      format: 'webp',
      width: 480,
      height: 480,
    });
    expect((await served(thumbUrl(hub, id), admin)).format).toBe('webp');
  });

  it('404 once the stored file is gone', async () => {
    const { id, sha } = await pictured();
    await served(thumbUrl(hub, id), host);
    rmSync(join(root, String(guest.id), `${sha}.webp`));
    expect(failed(await getBytes(thumbUrl(hub, id), host))).toEqual(THUMB_404);
  });

  it("404 for a non-canonical twin; the host's twin is served", async () => {
    const at = '2026-10-24T12:00:00.000Z';
    const guestTwin = await pictured(10, guest, at);
    const hostTwin = await pictured(200, host, at);
    expect(failed(await getBytes(thumbUrl(hub, guestTwin.id), host))).toEqual(
      THUMB_404,
    );
    expect((await served(thumbUrl(hub, hostTwin.id), host)).format).toBe(
      'webp',
    );
  });

  it("404 for another hub's save, even for its uploader", async () => {
    const sha = await storeBlob(guest.id, await makeWebp(40));
    const id = await save({
      uploader: guest.id,
      campaignId: foreignCamp,
      savedAt: '2026-10-24T12:00:00Z',
      sha,
    });
    await served(thumbUrl(otherHub, id), guest);
    expect(failed(await getBytes(thumbUrl(hub, id), guest))).toEqual(THUMB_404);
  });
});

describe('spoiler toggle on (D-14)', () => {
  it('nulls area + pictures for the uploader and staff, 404s the hub thumbnail', async () => {
    const { id } = await pictured();
    await hideSpoilers();
    for (const who of [guest, admin]) {
      const snap = Bg3SnapshotResponseSchema.parse(
        (await get(`${base(hub)}/snapshot?campaignId=${camp}`, who)).body,
      );
      if (snap.empty) throw new Error('expected a snapshot');
      expect([
        snap.saveId,
        snap.area,
        snap.thumbnailUrl,
        snap.spoilersHidden,
      ]).toEqual([id, null, null, true]);
      const ses = Bg3SessionsResponseSchema.parse(
        (await get(`${base(hub)}/campaigns/${camp}/sessions`, who)).body,
      );
      expect(
        ses.sessions.map((s) => [s.lastSaveId, s.areas, s.thumbnailUrl]),
      ).toEqual([[id, null, null]]);
      expect(failed(await getBytes(thumbUrl(hub, id), who))).toEqual(THUMB_404);
    }
  });

  it("still shows the uploader's own save area + picture under me/saves", async () => {
    const { id } = await pictured();
    await hideSpoilers();
    const res = await get('/plugins/bg3/me/saves', guest);
    const body = Bg3MySavesResponseSchema.parse(res.body);
    expect(body.saves.map((s) => [s.id, s.area, s.thumbnailUrl])).toEqual([
      [id, 'SCL_Main_A', ownUrl(id)],
    ]);
    expect((await served(ownUrl(id), guest)).format).toBe('webp');
    expect(failed(await getBytes(ownUrl(id), host))).toEqual(THUMB_404);
  });
});

describe('PUT hubs/:hubId/settings', () => {
  const settingsRow = async () =>
    testApp.db
      .select()
      .from(schema.bg3HubSettings)
      .where(eq(schema.bg3HubSettings.guildId, hub));

  it('403 Hub editors only for a plain member', async () => {
    const res = await putSettings(hub, guest, {
      hideLocationAndScreenshots: true,
    });
    expect(said(res)).toEqual([403, 'Hub editors only']);
    expect(await settingsRow()).toEqual([]);
  });

  it("400 campaign_not_in_hub for another hub's campaign", async () => {
    const res = await putSettings(hub, officer, {
      activeCampaignId: foreignCamp,
    });
    expect(said(res)).toEqual([400, 'campaign_not_in_hub']);
    expect(await settingsRow()).toEqual([]);
  });

  it('an editor upserts when no row exists, then updates it', async () => {
    expect(await settingsRow()).toEqual([]);
    const first = await putSettings(hub, officer, {
      hideLocationAndScreenshots: true,
      activeCampaignId: camp,
    });
    expect([first.status, first.body]).toEqual([
      200,
      { hideLocationAndScreenshots: true, activeCampaignId: camp },
    ]);
    const [row] = nonEmpty(await settingsRow(), 'settings row');
    expect(row.updatedByUserId).toBe(officer.id);
    const second = await putSettings(hub, admin, {
      hideLocationAndScreenshots: false,
    });
    expect(second.body).toEqual({
      hideLocationAndScreenshots: false,
      activeCampaignId: camp,
    });
    expect((await settingsRow()).length).toBe(1);
  });
});

describe('GET me/saves (§5.4)', () => {
  const mine = async (q = '') => {
    const res = await get(`/plugins/bg3/me/saves${q}`, guest);
    expect([res.status, res.headers['cache-control']]).toEqual([200, NO_STORE]);
    return Bg3MySavesResponseSchema.parse(res.body);
  };

  it('pages 51 rows as 50 + 1 and reports the default campaign', async () => {
    const start = Date.parse('2026-10-01T00:00:00Z');
    const ids: number[] = [];
    for (let i = 0; i < 51; i += 1) {
      const savedAt = new Date(start + i * 60_000).toISOString();
      ids.push(
        await save({
          uploader: guest.id,
          campaignId: i < 2 ? null : camp,
          savedAt,
        }),
      );
    }
    await save({
      uploader: host.id,
      campaignId: camp,
      savedAt: '2026-10-02T00:00:00Z',
    });
    await testApp.db
      .insert(schema.bg3UserDefaults)
      .values({ userId: guest.id, campaignId: camp });
    const first = await mine();
    expect([
      first.saves.length,
      first.saves[0]?.id,
      first.defaultCampaignId,
    ]).toEqual([50, ids.at(-1), camp]);
    if (first.nextCursor === null) throw new Error('expected a next cursor');
    const second = await mine(
      `?cursor=${encodeURIComponent(first.nextCursor)}`,
    );
    expect([second.saves.map((s) => s.id), second.nextCursor]).toEqual([
      [ids[0]],
      null,
    ]);
    const seen = new Set([...first.saves, ...second.saves].map((s) => s.id));
    expect(seen.size).toBe(51);
    const unassigned = await mine('?unassigned=true');
    expect(unassigned.saves.map((s) => [s.id, s.campaignId])).toEqual([
      [ids[1], null],
      [ids[0], null],
    ]);
  });
});

describe('Bg3GalleryFeed (§5.7)', () => {
  it('canonicalThumbnails keeps the host twin; openRawThumbnail returns stored bytes', async () => {
    const at = '2026-10-24T12:00:00.000Z';
    await pictured(10, guest, at);
    const hostTwin = await pictured(200, host, at);
    const feed = testApp.app.get(Bg3GalleryFeed);
    const items = await feed.canonicalThumbnails(hub);
    expect(items.map((i) => [i.saveId, i.uploaderUserId, i.sha256])).toEqual([
      [hostTwin.id, host.id, hostTwin.sha],
    ]);
    const raw = await feed.openRawThumbnail(hostTwin.id);
    expect(
      raw?.equals(
        readFileSync(join(root, String(host.id), `${hostTwin.sha}.webp`)),
      ),
    ).toBe(true);
    await hideSpoilers();
    expect([
      await feed.canonicalThumbnails(hub),
      await feed.openRawThumbnail(hostTwin.id),
    ]).toEqual([[], null]);
  });
});
