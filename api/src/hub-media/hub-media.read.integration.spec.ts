/**
 * ROK-1942 L2 — the Gallery routes against a real database + a tmpdir root:
 * D7 privacy (member / staff 200; visitor, hidden hub, missing hub → the hub
 * 404; signed out → 401), the newest-first cursor and the kind filter
 * (`screenshot` = screenshot + image), D8 moderation (member PATCH 403,
 * staff hide / unhide / remove), the bytes route headers, the tombstone
 * that is never listed nor re-ingested, and the DEMO_MODE seed.
 */
import { eq } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CORE_PLUGIN_ID,
  HubMediaListResponseSchema,
  type HubMediaKind,
  type HubMediaListResponse,
} from '@raid-ledger/contract';
import { signTestAccessToken } from '../common/testing/sign-test-access-token';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { HUB_NOT_FOUND } from '../guilds/hub-hidden.helpers';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../plugins/pelican/pelican.constants';
import { fakeServer } from '../plugins/pelican/testing/pelican-fixtures';
import { ensureFixtureHubId } from '../plugins/valheim/armory/valheim-armory-map-hub.helpers';
import {
  VALHEIM_GAME_SLUG,
  VALHEIM_PLUGIN_ID,
} from '../plugins/valheim/valheim.constants';
import { SettingsService } from '../settings/settings.service';
import {
  HUB_MEDIA_DOWNLOADER,
  type HubMediaDownloader,
} from './hub-media-download';
import { mediaFilePath } from './hub-media.paths';
import { HubMediaService } from './hub-media.service';
import { HubMediaSourceGateRegistry } from './hub-media.source-gates';
import { solidPng } from './hub-media.testing';

type Who = 'member' | 'visitor' | 'operator';
let testApp: TestApp;
let root: string;
let hubId: number;
let tokens: Record<Who, string>;
let download: jest.SpyInstance;

const base = (g = hubId) => `/hubs/${g}/media`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const get = (path: string, who: Who) =>
  testApp.request.get(path).set(auth(tokens[who]));

async function makeUser(name: string, role: 'member' | 'operator' = 'member') {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${name}`, username: name, role })
      .returning({ id: schema.users.id }),
    `user ${name}`,
  );
  return {
    id: u.id,
    token: await signTestAccessToken(testApp, { sub: u.id, username: name }),
  };
}

/** Ingest one picture `h` hours after a fixed base (higher h = newer). */
async function picture(key: string, kind: HubMediaKind, h: number) {
  const res = await testApp.app.get(HubMediaService).ingest({
    guildId: hubId,
    source: 'discord',
    kind,
    provenanceKey: key,
    sourceUrl: `https://cdn.discordapp.com/attachments/1/2/${key}.png`,
    authorName: 'Ragnar',
    caption: key,
    capturedAt: new Date(Date.UTC(2026, 9, 20, h)),
    discord: null,
  });
  if (res.status !== 'stored') throw new Error(`seed ${key}: ${res.status}`);
  return res.mediaId;
}

async function listOf(who: Who, qs = ''): Promise<HubMediaListResponse> {
  const res = await get(`${base()}${qs}`, who);
  expect({ status: res.status, cache: res.headers['cache-control'] }).toEqual({
    status: 200,
    cache: 'private, no-store',
  });
  return HubMediaListResponseSchema.parse(res.body);
}
const captions = (r: HubMediaListResponse) => r.items.map((i) => i.caption);

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'hub-media-read-'));
  process.env.HUB_MEDIA_DIR = root;
  testApp = await getTestApp();
});

afterAll(() => {
  delete process.env.HUB_MEDIA_DIR;
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  const registry = testApp.app.get(PluginRegistryService);
  for (const slug of [PELICAN_PLUGIN_ID, VALHEIM_PLUGIN_ID]) {
    await registry.ensureInstalled(slug);
    await registry.activate(slug);
  }
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'Valheim', slug: VALHEIM_GAME_SLUG })
      .returning({ id: schema.games.id }),
    'game',
  );
  const s = fakeServer(1);
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.pelicanServers)
      .values({
        panelUuid: s.uuid,
        identifier: s.identifier,
        name: s.name,
        gameId: g.id,
      })
      .returning({ id: schema.pelicanServers.id }),
    'server',
  );
  hubId = await ensureFixtureHubId(testApp.db, row.id, g.id);
  const member = await makeUser('member');
  await testApp.db.insert(schema.hubServerMembers).values({
    guildId: hubId,
    userId: member.id,
    source: 'manual',
    joinedAt: new Date(),
  });
  tokens = {
    member: member.token,
    visitor: (await makeUser('visitor')).token,
    operator: (await makeUser('operator', 'operator')).token,
  };
  const png = await solidPng(1200, 800, 3);
  const downloader = testApp.app.get<HubMediaDownloader>(HUB_MEDIA_DOWNLOADER);
  download = jest.spyOn(downloader, 'download').mockResolvedValue(png);
});

afterEach(() => {
  download.mockRestore();
});

describe('GET hubs/:guildId/media — privacy (D7)', () => {
  it('serves a hub member and a staff non-member', async () => {
    await picture('a', 'death', 1);
    expect(captions(await listOf('member'))).toEqual(['a']);
    expect(captions(await listOf('operator'))).toEqual(['a']);
  });

  it('answers a visitor, a hidden hub and a missing hub with the hub 404; signed out 401', async () => {
    const id = await picture('a', 'death', 1);
    const visitor = await get(base(), 'visitor');
    const visitorBytes = await get(`${base()}/${id}/thumb`, 'visitor');
    const missing = await get(base(hubId + 999), 'operator');
    const anon = await testApp.request.get(base());
    await testApp.db
      .update(schema.guilds)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.guilds.id, hubId));
    const hidden = await get(base(), 'member');
    expect(
      [visitor, visitorBytes, missing, hidden].map((r) => [
        r.status,
        r.body.message,
      ]),
    ).toEqual(Array(4).fill([404, HUB_NOT_FOUND]));
    expect(anon.status).toBe(401);
    expect((await get(base(), 'operator')).status).toBe(200);
  });

  it('gates the thumb bytes: signed out 401, visitor the hub 404, member 200 webp', async () => {
    const id = await picture('a', 'death', 1);
    const path = `${base()}/${id}/thumb`;
    const anon = await testApp.request.get(path);
    const visitor = await get(path, 'visitor');
    const member = await get(path, 'member').buffer(true);
    const body: unknown = member.body;
    const magic = Buffer.isBuffer(body)
      ? [
          body.subarray(0, 4).toString('latin1'),
          body.subarray(8, 12).toString('latin1'),
        ]
      : null;
    expect({
      anon: anon.status,
      visitor: [visitor.status, visitor.body.message],
      member: [member.status, member.headers['content-type'], magic],
    }).toEqual({
      anon: 401,
      visitor: [404, HUB_NOT_FOUND],
      member: [200, 'image/webp', ['RIFF', 'WEBP']],
    });
  });
});

describe('GET hubs/:guildId/media — feed order, cursor, kind filter', () => {
  beforeEach(async () => {
    await picture('d1', 'death', 1);
    await picture('s2', 'screenshot', 2);
    await picture('i3', 'image', 3);
    await picture('d4', 'death', 4);
    await picture('s5', 'screenshot', 5);
  });

  it('pages newest first with no gaps or repeats', async () => {
    const p1 = await listOf('member', '?limit=2');
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await listOf('member', `?limit=2&cursor=${p1.nextCursor}`);
    const p3 = await listOf('member', `?limit=2&cursor=${p2.nextCursor}`);
    expect([captions(p1), captions(p2), captions(p3), p3.nextCursor]).toEqual([
      ['s5', 'd4'],
      ['i3', 's2'],
      ['d1'],
      null,
    ]);
    expect({ total: p1.total, kinds: p1.kinds }).toEqual({
      total: 5,
      kinds: ['death', 'screenshot', 'image'],
    });
  });

  it('filters death, screenshot (= screenshot + image) and image', async () => {
    const death = await listOf('member', '?kind=death');
    const shots = await listOf('member', '?kind=screenshot');
    const image = await listOf('member', '?kind=image');
    expect({
      death: [captions(death), death.total],
      shots: [captions(shots), shots.total],
      image: [captions(image), image.total],
    }).toEqual({
      death: [['d4', 'd1'], 2],
      shots: [['s5', 'i3', 's2'], 3],
      image: [['i3'], 1],
    });
  });

  it('refuses a bad kind and a forged cursor with 400', async () => {
    const kind = await get(`${base()}?kind=selfie`, 'member');
    const cursor = await get(`${base()}?cursor=bm9wZQ`, 'member');
    expect([kind.status, cursor.status]).toEqual([400, 400]);
  });
});

describe('moderation (D8) + bytes route', () => {
  it('serves webp bytes with nosniff + the private immutable cache; 404 once the file is gone', async () => {
    const id = await picture('a', 'screenshot', 1);
    const res = await get(`${base()}/${id}/thumb`, 'member');
    expect({
      status: res.status,
      type: res.headers['content-type'],
      sniff: res.headers['x-content-type-options'],
      cache: res.headers['cache-control'],
    }).toEqual({
      status: 200,
      type: 'image/webp',
      sniff: 'nosniff',
      cache: 'private, max-age=604800, immutable',
    });
    const [row] = nonEmpty(
      await testApp.db.select().from(schema.hubMedia),
      'row',
    );
    await rm(mediaFilePath(hubId, row.storageName, 'full'));
    const gone = await get(`${base()}/${id}/full`, 'member');
    expect([gone.status, gone.headers['cache-control']]).toEqual([
      404,
      'no-store',
    ]);
  });

  it('member cannot hide (403); a staff hide drops it for members, flags it for editors, unhide restores', async () => {
    const id = await picture('a', 'death', 1);
    const memberPatch = await testApp.request
      .patch(`${base()}/${id}`)
      .set(auth(tokens.member))
      .send({ hidden: true });
    expect(memberPatch.status).toBe(403);
    const hide = await testApp.request
      .patch(`${base()}/${id}`)
      .set(auth(tokens.operator))
      .send({ hidden: true });
    expect([hide.status, hide.body.hidden]).toEqual([200, true]);
    const memberView = await listOf('member');
    const staffView = await listOf('operator');
    expect({
      member: [captions(memberView), memberView.total, memberView.kinds],
      staff: staffView.items.map((i) => [i.caption, i.hidden]),
      item: (await get(`${base()}/${id}`, 'member')).status,
      bytes: (await get(`${base()}/${id}/thumb`, 'member')).status,
    }).toEqual({
      member: [[], 0, []],
      staff: [['a', true]],
      item: 404,
      bytes: 404,
    });
    await testApp.request
      .patch(`${base()}/${id}`)
      .set(auth(tokens.operator))
      .send({ hidden: false });
    expect(captions(await listOf('member'))).toEqual(['a']);
  });

  it('remove is staff-only and leaves a tombstone that is never listed nor re-ingested', async () => {
    const id = await picture('a', 'death', 1);
    const del = (who: Who) =>
      testApp.request.delete(`${base()}/${id}`).set(auth(tokens[who]));
    expect([
      (await del('member')).status,
      (await del('visitor')).status,
    ]).toEqual([403, 404]);
    expect((await del('operator')).status).toBe(204);
    const [row] = nonEmpty(
      await testApp.db.select().from(schema.hubMedia),
      'row',
    );
    expect({
      removed: row.removedAt !== null,
      files: existsSync(mediaFilePath(hubId, row.storageName, 'thumb')),
      staffList: captions(await listOf('operator')),
      bytes: (await get(`${base()}/${id}/thumb`, 'operator')).status,
      again: (await del('operator')).status,
    }).toEqual({
      removed: true,
      files: false,
      staffList: [],
      bytes: 404,
      again: 404,
    });
    const reingest = await testApp.app.get(HubMediaService).ingest({
      guildId: hubId,
      source: 'discord',
      kind: 'death',
      provenanceKey: 'a',
      sourceUrl: 'https://cdn.discordapp.com/attachments/1/2/a.png',
      authorName: null,
      caption: null,
      capturedAt: new Date(),
      discord: null,
    });
    expect(reingest).toEqual({ status: 'duplicate', mediaId: id });
  });
});

describe('source gates (ROK-1959 D-5)', () => {
  /** The registry is an app singleton: the gate outlives this file, so it is core-owned and off by default. */
  let hideSaves = false;
  beforeAll(() => {
    testApp.app
      .get(HubMediaSourceGateRegistry)
      .register(CORE_PLUGIN_ID, 'bg3-save', () => Promise.resolve(hideSaves));
  });
  afterEach(() => {
    hideSaves = false;
  });

  async function save(): Promise<number> {
    const res = await testApp.app.get(HubMediaService).ingestFromSource({
      guildId: hubId,
      source: 'bg3-save',
      kind: 'save',
      provenanceKey: 'bg3-save:sha256:gate',
      uploadedBy: null,
      authorName: 'Ada',
      caption: 'save',
      capturedAt: new Date(Date.UTC(2026, 9, 20, 2)),
      bytes: await solidPng(1200, 800, 5),
    });
    if (res.status !== 'stored') throw new Error(`seed save: ${res.status}`);
    return res.mediaId;
  }
  const shape = (r: HubMediaListResponse) => ({
    captions: captions(r),
    total: r.total,
    kinds: r.kinds,
  });

  it('a gated source leaves list, total, kinds, item and bytes for editors and members alike', async () => {
    await picture('shot', 'screenshot', 1);
    const id = await save();
    const open = await listOf('operator');
    expect({ ...shape(open), source: open.items[0]?.source }).toEqual({
      captions: ['save', 'shot'],
      total: 2,
      kinds: ['screenshot', 'save'],
      source: { type: 'bg3-save', label: 'Game save' },
    });
    hideSaves = true;
    for (const who of ['operator', 'member'] as const) {
      expect(shape(await listOf(who))).toEqual({
        captions: ['shot'],
        total: 1,
        kinds: ['screenshot'],
      });
    }
    expect(shape(await listOf('operator', '?kind=save')).total).toBe(0);
    const paths = [`${base()}/${id}`, `${base()}/${id}/thumb`];
    const statuses = await Promise.all(
      paths.map(async (p) => (await get(p, 'operator')).status),
    );
    expect(statuses).toEqual([404, 404]);
  });
});

describe('POST /admin/test/hub-media/seed (DEMO_MODE)', () => {
  const ORIGINAL = process.env.DEMO_MODE;
  afterEach(async () => {
    if (ORIGINAL === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = ORIGINAL;
    await testApp.app.get(SettingsService).setDemoMode(false);
  });

  it('seeds every kind without the network, and is 403 outside DEMO_MODE', async () => {
    const admin = await loginAsAdmin(testApp.request, testApp.seed);
    const seed = () =>
      testApp.request
        .post('/admin/test/hub-media/seed')
        .set(auth(admin))
        .send({ guildId: hubId, count: 4 });
    process.env.DEMO_MODE = 'false';
    expect((await seed()).status).toBe(403);
    process.env.DEMO_MODE = 'true';
    await testApp.app.get(SettingsService).setDemoMode(true);
    const res = await seed();
    expect([res.status, res.body.ids?.length]).toEqual([200, 4]);
    expect(download).not.toHaveBeenCalled();
    const list = await listOf('operator');
    expect({ total: list.total, kinds: list.kinds }).toEqual({
      total: 4,
      kinds: ['death', 'screenshot', 'image'],
    });
  });
});
