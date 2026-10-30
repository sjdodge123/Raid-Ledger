/**
 * ROK-1814 L2 — the crest routes against a real database + tmpdir stores:
 * editor matrix (leader/officer/staff 2xx; member/visitor 403), preset
 * set/clear, staff-only upload removal (records removed_by/at, falls back
 * to the preset), the gallery pick (this hub only; another hub's id 404)
 * (this hub only; another hub's id or a hidden picture 404; a 1600 × 900
 * picture is downsized, not refused), removal deletes the files, and
 * `GuildSummary.crest` on `GET /guilds/:id` and `GET /guilds/mine`.
 * Fix lane 3: a gallery picture whose SOURCE is gated (spoiler toggle,
 * plugin off) is 404 like a hidden one; the multipart 413 / 415 wiring.
 */
import { eq } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Redis from 'ioredis';
import {
  GUILD_CREST_UPLOAD_MAX_BYTES,
  GuildCrestEditorStateSchema,
  GuildPageSchema,
  HubMediaItemSchema,
  MyGuildsSchema,
} from '@raid-ledger/contract';
import { signTestAccessToken } from '../../common/testing/sign-test-access-token';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { solidPng } from '../../hub-media/hub-media.testing';
import { HubMediaSourceGateRegistry } from '../../hub-media/hub-media.source-gates';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { insertCommunityHub } from '../community/community-proposals.queries';
import { crestFilePath } from './hub-crest.paths';

type Who = 'leader' | 'officer' | 'member' | 'visitor' | 'operator';
const PRESET = { emblemId: 'crossed-swords', fg: 'or', bg: 'gules' };
let testApp: TestApp;
let hubId: number;
let otherHubId: number;
let ids: Record<Who, number>;
let tokens: Record<Who, string>;
let n = 0;
/** Toggled per test: a `core` gate that hides `upload` pictures on `hubId`. */
let gateUploads = false;
const tempDirs: string[] = [];
const ENV_KEYS = ['GUILD_CREST_DIR', 'HUB_MEDIA_DIR'] as const;
const savedEnv = ENV_KEYS.map((k) => [k, process.env[k]] as const);

/** A fresh tmpdir, removed in afterAll. */
async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** The same per-role pick for every test user, without a cast. */
function perRole<U, T>(
  users: Record<Who, U>,
  pick: (u: U) => T,
): Record<Who, T> {
  return {
    leader: pick(users.leader),
    officer: pick(users.officer),
    member: pick(users.member),
    visitor: pick(users.visitor),
    operator: pick(users.operator),
  };
}

/** The crest key from an editor-state upload URL. */
const keyOf = (u: string | undefined): string =>
  u?.split('/').pop()?.split('.')[0] ?? '';

const auth = (who: Who) => ({ Authorization: `Bearer ${tokens[who]}` });
const url = (g = hubId) => `/guilds/${g}/crest`;
const upload = async (who: Who) =>
  testApp.request
    .post(`${url()}/upload`)
    .set(auth(who))
    .attach('file', await solidPng(200, 120, (n += 1)), {
      filename: 'crest.png',
      contentType: 'image/png',
    });
const put = (who: Who, body: object) =>
  testApp.request.put(url()).set(auth(who)).send(body);
const state = (body: unknown) => GuildCrestEditorStateSchema.parse(body);

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

async function makeHub(name: string, leaderId: number): Promise<number> {
  const hub = await insertCommunityHub(testApp.db, {
    gameId: testApp.seed.game.id,
    name,
    blurb: 'Crest hub',
    status: 'active',
    proposedBy: leaderId,
    reviewedBy: null,
  });
  return hub.id;
}

async function galleryItem(g: number, w = 300, h = 300): Promise<number> {
  const res = await testApp.request
    .post(`/hubs/${g}/media`)
    .set(auth('leader'))
    .attach('file', await solidPng(w, h, (n += 1)), {
      filename: 'pic.png',
      contentType: 'image/png',
    });
  expect(res.status).toBe(201);
  return HubMediaItemSchema.parse(res.body).id;
}

beforeAll(async () => {
  testApp = await getTestApp();
  testApp.app
    .get(HubMediaSourceGateRegistry)
    .register('core', 'upload', (g) =>
      Promise.resolve(gateUploads && g === hubId),
    );
});

afterAll(async () => {
  for (const [k, v] of savedEnv) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await Promise.all(
    tempDirs.map((d) => rm(d, { recursive: true, force: true })),
  );
});

beforeEach(async () => {
  gateUploads = false;
  process.env.GUILD_CREST_DIR = await tempDir('guild-crest-');
  process.env.HUB_MEDIA_DIR = await tempDir('crest-media-');
  testApp.seed = await truncateAllTables(testApp.db);
  const redis = testApp.app.get<Redis>(REDIS_CLIENT);
  const keys = await redis.keys('guild-crest-upload:*');
  if (keys.length > 0) await redis.del(...keys);
  const users = {
    leader: await makeUser('leader'),
    officer: await makeUser('officer'),
    member: await makeUser('member'),
    visitor: await makeUser('visitor'),
    operator: await makeUser('operator', 'operator'),
  };
  hubId = await makeHub('Camp', users.leader.id);
  otherHubId = await makeHub('Other', users.leader.id);
  await testApp.db.insert(schema.hubCommunityMembers).values([
    { guildId: hubId, userId: users.leader.id, role: 'leader' as const },
    { guildId: hubId, userId: users.officer.id, role: 'officer' as const },
    { guildId: hubId, userId: users.member.id, role: 'member' as const },
    { guildId: otherHubId, userId: users.leader.id, role: 'leader' as const },
  ]);
  ids = perRole(users, (u) => u.id);
  tokens = perRole(users, (u) => u.token);
});

describe('POST /guilds/:id/crest/upload', () => {
  it.each<Who>(['leader', 'officer', 'operator'])(
    '%s may upload',
    async (who) => {
      const res = await upload(who);
      expect(res.status).toBe(200);
      const s = state(res.body);
      expect(s.active).toBe('upload');
      const key = keyOf(s.upload?.urlLg);
      expect(existsSync(crestFilePath(hubId, key, 'lg'))).toBe(true);
    },
  );

  it.each<Who>(['member', 'visitor'])('%s gets 403', async (who) => {
    expect((await upload(who)).status).toBe(403);
  });

  it('413 too_large over the 1 MiB cap (multer + the crest filter)', async () => {
    const res = await testApp.request
      .post(`${url()}/upload`)
      .set(auth('leader'))
      .attach('file', Buffer.alloc(GUILD_CREST_UPLOAD_MAX_BYTES + 1, 1), {
        filename: 'big.png',
        contentType: 'image/png',
      });
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ code: 'too_large' });
  });

  it('415 for a file that is not a picture', async () => {
    const res = await testApp.request
      .post(`${url()}/upload`)
      .set(auth('leader'))
      .attach('file', Buffer.from('just some text, not an image'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      });
    expect(res.status).toBe(415);
    expect(res.body).toMatchObject({ code: 'not_image' });
  });

  it('a replace deletes the previous files after the update', async () => {
    const first = state((await upload('leader')).body);
    const oldKey = keyOf(first.upload?.urlSm);
    expect((await upload('leader')).status).toBe(200);
    expect(existsSync(crestFilePath(hubId, oldKey, 'sm'))).toBe(false);
  });
});

describe('PUT /guilds/:id/crest', () => {
  it('saves a preset, then clears the shown crest', async () => {
    const set = await put('officer', { active: 'preset', preset: PRESET });
    expect(set.status).toBe(200);
    expect(state(set.body)).toMatchObject({ active: 'preset', preset: PRESET });
    const cleared = state((await put('officer', { active: null })).body);
    expect(cleared).toMatchObject({ active: null, preset: PRESET });
  });

  it('a member gets 403', async () => {
    expect((await put('member', { active: null })).status).toBe(403);
  });
});

describe('DELETE /guilds/:id/crest/upload', () => {
  it('staff removal records removed_by/at and falls back to the preset', async () => {
    await put('leader', { active: 'preset', preset: PRESET });
    const key = keyOf(state((await upload('leader')).body).upload?.urlLg);
    expect(existsSync(crestFilePath(hubId, key, 'lg'))).toBe(true);
    const res = await testApp.request
      .delete(`${url()}/upload`)
      .set(auth('operator'));
    expect(res.status).toBe(200);
    expect(existsSync(crestFilePath(hubId, key, 'lg'))).toBe(false);
    expect(existsSync(crestFilePath(hubId, key, 'sm'))).toBe(false);
    expect(state(res.body)).toMatchObject({ active: 'preset', upload: null });
    const [row] = await testApp.db
      .select()
      .from(schema.guilds)
      .where(eq(schema.guilds.id, hubId));
    expect(row?.crestRemovedBy).toBe(ids.operator);
    expect(row?.crestRemovedAt).toBeInstanceOf(Date);
    expect(row?.crestUploadKey).toBeNull();
  });

  // Operator ruling 2026-10-30: any editor change clears "removed by an admin".
  it.each([
    [
      'picks a preset',
      () => put('leader', { active: 'preset', preset: PRESET }),
    ],
    ['hides the crest', () => put('leader', { active: null })],
    ['uploads', () => upload('leader')],
    [
      'picks a gallery picture',
      async () =>
        testApp.request
          .post(`${url()}/from-gallery`)
          .set(auth('leader'))
          .send({ mediaId: await galleryItem(hubId) }),
    ],
  ] as const)(
    'an editor who %s clears the staff removal',
    async (_l, change) => {
      await upload('leader');
      const removed = await testApp.request
        .delete(`${url()}/upload`)
        .set(auth('operator'));
      expect(state(removed.body).removedByStaffAt).not.toBeNull();
      const res = await change();
      expect(res.status).toBe(200);
      expect(state(res.body).removedByStaffAt).toBeNull();
      const [row] = await testApp.db
        .select()
        .from(schema.guilds)
        .where(eq(schema.guilds.id, hubId));
      expect(row?.crestRemovedAt).toBeNull();
      expect(row?.crestRemovedBy).toBeNull();
    },
  );

  it('an editor (leader) cannot remove an upload', async () => {
    await upload('leader');
    const res = await testApp.request
      .delete(`${url()}/upload`)
      .set(auth('leader'));
    expect(res.status).toBe(403);
  });
});

describe('POST /guilds/:id/crest/from-gallery', () => {
  it("re-encodes this hub's gallery picture as the upload", async () => {
    const mediaId = await galleryItem(hubId);
    const res = await testApp.request
      .post(`${url()}/from-gallery`)
      .set(auth('leader'))
      .send({ mediaId });
    expect(res.status).toBe(200);
    const s = state(res.body);
    expect(s.active).toBe('upload');
    expect(s.upload?.urlLg).toMatch(/^\/uploads\/guild-crests\//);
  });

  it('downsizes a 1600 × 900 gallery picture instead of refusing it', async () => {
    const mediaId = await galleryItem(hubId, 1600, 900);
    const res = await testApp.request
      .post(`${url()}/from-gallery`)
      .set(auth('leader'))
      .send({ mediaId });
    expect(res.status).toBe(200);
    const key = keyOf(state(res.body).upload?.urlLg);
    expect(existsSync(crestFilePath(hubId, key, 'lg'))).toBe(true);
  });

  it('404s for a hidden gallery picture', async () => {
    const mediaId = await galleryItem(hubId);
    await testApp.db
      .update(schema.hubMedia)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.hubMedia.id, mediaId));
    const res = await testApp.request
      .post(`${url()}/from-gallery`)
      .set(auth('leader'))
      .send({ mediaId });
    expect(res.status).toBe(404);
  });

  it('404s for a picture whose source a gate hides (no crest written)', async () => {
    const mediaId = await galleryItem(hubId);
    gateUploads = true;
    const res = await testApp.request
      .post(`${url()}/from-gallery`)
      .set(auth('leader'))
      .send({ mediaId });
    expect(res.status).toBe(404);
    const [row] = await testApp.db
      .select({ key: schema.guilds.crestUploadKey })
      .from(schema.guilds)
      .where(eq(schema.guilds.id, hubId));
    expect(row?.key).toBeNull();
  });

  it("404s for another hub's picture", async () => {
    const mediaId = await galleryItem(otherHubId);
    const res = await testApp.request
      .post(`${url()}/from-gallery`)
      .set(auth('leader'))
      .send({ mediaId });
    expect(res.status).toBe(404);
  });
});

describe('GuildSummary.crest', () => {
  it('GET /guilds/:id carries the active crest', async () => {
    await put('leader', { active: 'preset', preset: PRESET });
    const res = await testApp.request
      .get(`/guilds/${hubId}`)
      .set(auth('member'));
    expect(res.status).toBe(200);
    const page = GuildPageSchema.parse(res.body);
    expect(page.guild.crest).toEqual({ source: 'preset', ...PRESET });
  });

  // ROK-1814 rulings 2026-10-30: the crest UI's staff + edit flags.
  it.each([
    ['operator', { isStaff: true, canEditCrest: true }],
    ['leader', { isStaff: false, canEditCrest: true }],
    ['officer', { isStaff: false, canEditCrest: true }],
    ['member', { isStaff: false, canEditCrest: false }],
  ] as const)('GET /guilds/:id viewer flags for %s', async (who, flags) => {
    const res = await testApp.request.get(`/guilds/${hubId}`).set(auth(who));
    expect(res.status).toBe(200);
    expect(GuildPageSchema.parse(res.body).viewer).toMatchObject(flags);
  });

  it('GET /guilds/mine carries the active crest', async () => {
    await put('leader', { active: 'preset', preset: PRESET });
    const res = await testApp.request.get('/guilds/mine').set(auth('member'));
    expect(res.status).toBe(200);
    const mine = MyGuildsSchema.parse(res.body).guilds.find(
      (g) => g.id === hubId,
    );
    expect(mine?.crest).toEqual({ source: 'preset', ...PRESET });
  });
});
