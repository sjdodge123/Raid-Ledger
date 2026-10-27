/**
 * ROK-1965 L2 — `POST /hubs/:guildId/media` and the changed Remove against a
 * real database + a tmpdir root (spec §7): who may upload (404 otherwise),
 * magic-byte types (415), the 9 MiB cap (413 too_large), idempotent re-upload
 * (200) and the tombstone (409), the per-hub cap under the advisory lock
 * (413 cap), the per-user window (429), leader-or-uploader Remove (D11) and
 * the per-viewer `canRemove` (D12), uploads under the Screenshots chip (D7).
 */
import { eq } from 'drizzle-orm';
import { readdirSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Redis from 'ioredis';
import {
  HubMediaItemSchema,
  HubMediaListResponseSchema,
} from '@raid-ledger/contract';
import { signTestAccessToken } from '../common/testing/sign-test-access-token';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { insertCommunityHub } from '../guilds/community/community-proposals.queries';
import { REDIS_CLIENT } from '../redis/redis.module';
import {
  HUB_MEDIA_DOWNLOADER,
  type HubMediaDownloader,
} from './hub-media-download';
import { bytesUsed } from './hub-media.repository';
import { HubMediaService } from './hub-media.service';
import { solidPng } from './hub-media.testing';

type Who = 'leader' | 'alice' | 'bob' | 'visitor' | 'operator';
let testApp: TestApp;
let root: string;
let hubId: number;
let ids: Record<Who, number>;
let tokens: Record<Who, string>;
let n = 0;

const base = (g = hubId) => `/hubs/${g}/media`;
const auth = (who: Who) => ({ Authorization: `Bearer ${tokens[who]}` });
const post = (who: Who, bytes: Buffer, g = hubId) =>
  testApp.request
    .post(base(g))
    .set(auth(who))
    .attach('file', bytes, { filename: 'pic.png', contentType: 'image/png' });
const del = (who: Who, id: number) =>
  testApp.request.delete(`${base()}/${id}`).set(auth(who));
const png = () => solidPng(64, 48, (n += 1));
const filesOnDisk = () =>
  readdirSync(root, { recursive: true, withFileTypes: true }).filter((d) =>
    d.isFile(),
  ).length;

async function makeUser(name: string, role: 'member' | 'operator' = 'member') {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ username: name, displayName: `${name} D`, role })
      .returning({ id: schema.users.id }),
    `user ${name}`,
  );
  const token = await signTestAccessToken(testApp, {
    sub: u.id,
    username: name,
  });
  return { id: u.id, token };
}

async function uploaded(who: Who): Promise<number> {
  const res = await post(who, await png());
  expect(res.status).toBe(201);
  return HubMediaItemSchema.parse(res.body).id;
}

async function discordRow(): Promise<number> {
  const downloader = testApp.app.get<HubMediaDownloader>(HUB_MEDIA_DOWNLOADER);
  const spy = jest.spyOn(downloader, 'download').mockResolvedValue(await png());
  const res = await testApp.app.get(HubMediaService).ingest({
    guildId: hubId,
    source: 'discord',
    kind: 'screenshot',
    provenanceKey: `discord:1:2:${(n += 1)}`,
    sourceUrl: 'https://cdn.discordapp.com/attachments/1/2/x.png',
    authorName: 'Ragnar',
    caption: null,
    capturedAt: new Date(Date.UTC(2026, 0, 1)),
    discord: null,
  });
  spy.mockRestore();
  if (res.status !== 'stored') throw new Error(`seed: ${res.status}`);
  return res.mediaId;
}

async function listAs(who: Who, qs = '') {
  const res = await testApp.request.get(`${base()}${qs}`).set(auth(who));
  expect(res.status).toBe(200);
  return HubMediaListResponseSchema.parse(res.body);
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'hub-media-upload-'));
  process.env.HUB_MEDIA_DIR = root;
  testApp = await getTestApp();
});

afterAll(() => {
  delete process.env.HUB_MEDIA_DIR;
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  const redis = testApp.app.get<Redis>(REDIS_CLIENT);
  const keys = await redis.keys('hub-media-upload:*');
  if (keys.length > 0) await redis.del(...keys);
  const users = {
    leader: await makeUser('leader'),
    alice: await makeUser('alice'),
    bob: await makeUser('bob'),
    visitor: await makeUser('visitor'),
    operator: await makeUser('operator', 'operator'),
  };
  const hub = await insertCommunityHub(testApp.db, {
    gameId: testApp.seed.game.id,
    name: 'Camp',
    blurb: 'Upload hub',
    status: 'active',
    proposedBy: users.leader.id,
    reviewedBy: null,
  });
  hubId = hub.id;
  await testApp.db.insert(schema.hubCommunityMembers).values([
    { guildId: hubId, userId: users.leader.id, role: 'leader' as const },
    { guildId: hubId, userId: users.alice.id, role: 'member' as const },
    { guildId: hubId, userId: users.bob.id, role: 'member' as const },
  ]);
  ids = Object.fromEntries(
    Object.entries(users).map(([k, u]) => [k, u.id]),
  ) as Record<Who, number>;
  tokens = Object.fromEntries(
    Object.entries(users).map(([k, u]) => [k, u.token]),
  ) as Record<Who, string>;
});

afterEach(() => {
  delete process.env.HUB_MEDIA_UPLOAD_PER_HOUR;
  delete process.env.HUB_MEDIA_MAX_BYTES_PER_HUB;
});

describe('POST hubs/:guildId/media — who may upload (D2)', () => {
  it('stores a member upload as source/kind upload with uploaded_by, first in the list, canRemove true', async () => {
    await discordRow();
    const res = await post('alice', await png());
    const item = HubMediaItemSchema.parse(res.body);
    const [row] = nonEmpty(
      await testApp.db
        .select()
        .from(schema.hubMedia)
        .where(eq(schema.hubMedia.id, item.id)),
      'row',
    );
    const list = await listAs('alice');
    expect({
      status: res.status,
      cache: res.headers['cache-control'],
      source: item.source,
      kind: item.kind,
      author: item.authorName,
      canRemove: item.canRemove,
      row: {
        source: row.source,
        kind: row.kind,
        uploadedBy: row.uploadedBy,
        caption: row.caption,
      },
      first: list.items[0]?.id,
      files: filesOnDisk(),
    }).toEqual({
      status: 201,
      cache: 'private, no-store',
      source: { type: 'upload', label: 'Uploaded' },
      kind: 'upload',
      author: 'alice D',
      canRemove: true,
      row: {
        source: 'upload',
        kind: 'upload',
        uploadedBy: ids.alice,
        caption: null,
      },
      first: item.id,
      files: 4,
    });
  });

  it('answers a visitor on an open community hub and a missing hub with 404, signed out 401, and stores nothing', async () => {
    const bytes = await png();
    const visitor = await post('visitor', bytes);
    const missing = await post('operator', bytes, hubId + 999);
    const anon = await testApp.request
      .post(base())
      .attach('file', bytes, 'a.png');
    const rows = await testApp.db.select().from(schema.hubMedia);
    expect([visitor.status, missing.status, anon.status, rows.length]).toEqual([
      404, 404, 401, 0,
    ]);
  });

  it('lets staff upload to any hub', async () => {
    expect((await post('operator', await png())).status).toBe(201);
  });
});

describe('POST — types and size (D3, D4)', () => {
  it('refuses a text file named .png and a GIF with 415 not_image', async () => {
    const text = await post('alice', Buffer.from('hello, not a picture'));
    const gif = await post(
      'alice',
      Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'binary'),
    );
    expect([text.status, text.body.code, gif.status, gif.body.code]).toEqual([
      415,
      'not_image',
      415,
      'not_image',
    ]);
  });

  it('refuses a body over 9 MiB with 413 too_large and leaves no file behind', async () => {
    const big = Buffer.concat([await png(), Buffer.alloc(10 * 1024 * 1024)]);
    const res = await post('alice', big);
    expect({
      status: res.status,
      code: res.body.code,
      files: filesOnDisk(),
    }).toEqual({
      status: 413,
      code: 'too_large',
      files: 0,
    });
  });

  it('answers 400 when no file part is sent', async () => {
    const res = await testApp.request
      .post(base())
      .set(auth('alice'))
      .field('x', '1');
    expect(res.status).toBe(400);
  });
});

describe('POST — dedupe, tombstone, cap, rate (D5, D8, D10)', () => {
  it('201 then 200 with the same id for the same bytes; 409 removed after a Remove', async () => {
    const bytes = await png();
    const first = await post('alice', bytes);
    const again = await post('bob', bytes);
    const id = HubMediaItemSchema.parse(first.body).id;
    expect((await del('leader', id)).status).toBe(204);
    const after = await post('alice', bytes);
    expect([
      first.status,
      again.status,
      again.body.id,
      after.status,
      after.body.code,
    ]).toEqual([201, 200, id, 409, 'removed']);
  });

  it('two racing uploads near the hub cap: exactly one stores, the other is 413 cap', async () => {
    await uploaded('alice');
    const used = await bytesUsed(testApp.db, hubId);
    process.env.HUB_MEDIA_MAX_BYTES_PER_HUB = String(Math.floor(used * 2.5));
    const [a, b] = await Promise.all([
      post('alice', await png()),
      post('bob', await png()),
    ]);
    const out = [a, b]
      .map((r) => `${r.status}:${String(r.body.code ?? '')}`)
      .sort();
    expect(out).toEqual(['201:', '413:cap']);
  });

  it('the per-user window answers 429 rate_limited past the allowance', async () => {
    process.env.HUB_MEDIA_UPLOAD_PER_HOUR = '2';
    const s1 = (await post('alice', await png())).status;
    const s2 = (await post('alice', Buffer.from('not a picture'))).status;
    const third = await post('alice', await png());
    const other = await post('bob', await png());
    expect([s1, s2, third.status, third.body.code, other.status]).toEqual([
      201,
      415,
      429,
      'rate_limited',
      201,
    ]);
  });
});

describe('DELETE hubs/:guildId/media/:id — leader or uploader (D11)', () => {
  it('a community Leader removes a Discord row and another member’s upload', async () => {
    const discord = await discordRow();
    const upload = await uploaded('alice');
    const statuses = [
      (await del('leader', discord)).status,
      (await del('leader', upload)).status,
    ];
    const rows = await testApp.db.select().from(schema.hubMedia);
    expect({
      statuses,
      tombstones: rows.map((r) => r.removedAt !== null),
      files: filesOnDisk(),
    }).toEqual({ statuses: [204, 204], tombstones: [true, true], files: 0 });
  });

  it('a plain member removes their own upload, not another member’s; staff removes any', async () => {
    const own = await uploaded('alice');
    const bobs = await uploaded('bob');
    const discord = await discordRow();
    const res = [
      (await del('alice', own)).status,
      (await del('alice', bobs)).status,
      (await del('alice', discord)).status,
      (await del('operator', bobs)).status,
    ];
    expect(res).toEqual([204, 403, 403, 204]);
  });
});

describe('canRemove per viewer (D12) and the Screenshots chip (D7)', () => {
  it('leader: all; uploader: own only; other member: none', async () => {
    await discordRow();
    const alices = await uploaded('alice');
    const flags = async (who: Who) =>
      Object.fromEntries(
        (await listAs(who)).items.map((i) => [i.id, i.canRemove]),
      );
    const leader = await flags('leader');
    const alice = await flags('alice');
    const bob = await flags('bob');
    expect({
      leader: Object.values(leader),
      aliceOwn: alice[alices],
      aliceAll: Object.values(alice).filter(Boolean).length,
      bob: Object.values(bob),
    }).toEqual({
      leader: [true, true],
      aliceOwn: true,
      aliceAll: 1,
      bob: [false, false],
    });
  });

  it('kind=screenshot returns uploads, and kinds lists upload', async () => {
    const id = await uploaded('alice');
    const list = await listAs('alice', '?kind=screenshot');
    expect({ ids: list.items.map((i) => i.id), kinds: list.kinds }).toEqual({
      ids: [id],
      kinds: ['upload'],
    });
  });
});
