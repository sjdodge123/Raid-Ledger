/**
 * ROK-1814 L2 — the crest routes against a real database + tmpdir stores:
 * editor matrix (leader/officer/staff 2xx; member/visitor 403), preset
 * set/clear, staff-only upload removal (records removed_by/at, falls back
 * to the preset), the gallery pick (this hub only; another hub's id 404)
 * and `GuildSummary.crest` on `GET /guilds/:id`.
 */
import { eq } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Redis from 'ioredis';
import {
  GuildCrestEditorStateSchema,
  GuildPageSchema,
  HubMediaItemSchema,
} from '@raid-ledger/contract';
import { signTestAccessToken } from '../../common/testing/sign-test-access-token';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { solidPng } from '../../hub-media/hub-media.testing';
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

async function galleryItem(g: number): Promise<number> {
  const res = await testApp.request
    .post(`/hubs/${g}/media`)
    .set(auth('leader'))
    .attach('file', await solidPng(300, 300, (n += 1)), {
      filename: 'pic.png',
      contentType: 'image/png',
    });
  expect(res.status).toBe(201);
  return HubMediaItemSchema.parse(res.body).id;
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  process.env.GUILD_CREST_DIR = await mkdtemp(join(tmpdir(), 'guild-crest-'));
  process.env.HUB_MEDIA_DIR = await mkdtemp(join(tmpdir(), 'crest-media-'));
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
  ids = Object.fromEntries(
    Object.entries(users).map(([k, u]) => [k, u.id]),
  ) as Record<Who, number>;
  tokens = Object.fromEntries(
    Object.entries(users).map(([k, u]) => [k, u.token]),
  ) as Record<Who, string>;
});

describe('POST /guilds/:id/crest/upload', () => {
  it.each<Who>(['leader', 'officer', 'operator'])(
    '%s may upload',
    async (who) => {
      const res = await upload(who);
      expect(res.status).toBe(200);
      const s = state(res.body);
      expect(s.active).toBe('upload');
      const key = s.upload?.urlLg.split('/').pop()?.split('.')[0] ?? '';
      expect(existsSync(crestFilePath(hubId, key, 'lg'))).toBe(true);
    },
  );

  it.each<Who>(['member', 'visitor'])('%s gets 403', async (who) => {
    expect((await upload(who)).status).toBe(403);
  });

  it('a replace deletes the previous files after the update', async () => {
    const first = state((await upload('leader')).body);
    const oldKey = first.upload?.urlSm.split('/').pop()?.split('.')[0] ?? '';
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
    await upload('leader');
    const res = await testApp.request
      .delete(`${url()}/upload`)
      .set(auth('operator'));
    expect(res.status).toBe(200);
    expect(state(res.body)).toMatchObject({ active: 'preset', upload: null });
    const [row] = await testApp.db
      .select()
      .from(schema.guilds)
      .where(eq(schema.guilds.id, hubId));
    expect(row?.crestRemovedBy).toBe(ids.operator);
    expect(row?.crestRemovedAt).toBeInstanceOf(Date);
    expect(row?.crestUploadKey).toBeNull();
  });

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
});
