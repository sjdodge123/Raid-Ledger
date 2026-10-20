/**
 * ROK-1432 — admin lifecycle routes against a real DB (spec ROK-1428 §2.11
 * A1–A7). FLEET-ONLY (Postgres + the Redis sidecar). Discord ops are spied
 * on the module object (memory `reference_integration_jest_mock_singleton_app`);
 * the bot client is stubbed per test.
 */
import { eq } from 'drizzle-orm';
import { Collection, type Guild } from 'discord.js';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import { signTestAccessToken } from '../../common/testing/sign-test-access-token';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import * as ops from './channel-lifecycle.discord-ops';
import { ENABLE_REFUSED } from './channel-lifecycle-admin.service';
import { selectGameLifecycleActivity } from './game-activity.queries';

const BASE = '/admin/discord/lifecycle';
const GUILD = 'rok1432-guild';
/** A connected guild with an empty channel cache (the bindings list reads it). */
const guild = {
  id: GUILD,
  channels: { cache: new Collection() },
} as unknown as Guild;
let t: TestApp;
let admin: string;
let member: string;

function stubBot(connected: boolean): void {
  const client = t.app.get(DiscordBotClientService);
  jest.spyOn(client, 'isConnected').mockReturnValue(connected);
  jest.spyOn(client, 'getGuild').mockReturnValue(connected ? guild : null);
  jest.spyOn(client, 'getGuildId').mockReturnValue(connected ? GUILD : null);
}

async function memberToken(): Promise<string> {
  const [u] = nonEmpty(
    await t.db
      .insert(schema.users)
      .values({ discordId: 'local:l6-member@test', username: 'l6member' })
      .returning(),
    'member',
  );
  return signTestAccessToken(t, { sub: u.id, username: u.username });
}

async function gameBinding(auto: boolean): Promise<string> {
  const [g] = nonEmpty(
    await t.db
      .insert(schema.games)
      .values({ name: `L6 ${auto}`, slug: `l6-${auto}-${Date.now()}` })
      .returning({ id: schema.games.id }),
    'game',
  );
  const svc = t.app.get(ChannelBindingsService);
  const { binding } = await svc.bind(
    GUILD,
    `ch-${g.id}`,
    'text',
    'game-announcements',
    g.id,
  );
  if (auto) {
    await t.db
      .update(schema.channelBindings)
      .set({ autoManaged: true })
      .where(eq(schema.channelBindings.id, binding.id));
  }
  return binding.id;
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  t = await getTestApp();
});

beforeEach(async () => {
  admin = await loginAsAdmin(t.request, t.seed);
  member = await memberToken();
  stubBot(true);
});

afterEach(async () => {
  jest.restoreAllMocks();
  t.seed = await truncateAllTables(t.db);
});

describe('A1 — admin only', () => {
  it.each([
    ['get', `${BASE}/settings`],
    ['patch', `${BASE}/settings`],
    ['get', `${BASE}/activity`],
    ['post', `${BASE}/reconcile`],
    ['get', `${BASE}/suppressions`],
    ['delete', `${BASE}/suppressions/1`],
  ] as const)('%s %s → 403 for a member', async (method, path) => {
    const res = await t.request[method](path).set(as(member)).send({});
    expect(res.status).toBe(403);
  });
});

describe('A2 — settings round-trip', () => {
  it('persists a valid patch and reads it back', async () => {
    const patch = { recentActivityDays: 14, createThreshold: 3 };
    const res = await t.request
      .patch(`${BASE}/settings`)
      .set(as(admin))
      .send(patch);
    expect(res.status).toBe(200);
    const read = await t.request.get(`${BASE}/settings`).set(as(admin));
    expect(read.body).toMatchObject({ ...patch, enabled: false });
  });

  it.each([{ recentActivityDays: 3 }, { createThreshold: 11 }, { bogus: 1 }])(
    '400s %o',
    async (body) => {
      const res = await t.request
        .patch(`${BASE}/settings`)
        .set(as(admin))
        .send(body);
      expect(res.status).toBe(400);
    },
  );
});

describe('A3/A4 — enable guard', () => {
  it('A3: bot offline → 400 and stays disabled', async () => {
    stubBot(false);
    const res = await t.request
      .patch(`${BASE}/settings`)
      .set(as(admin))
      .send({ enabled: true });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain(ENABLE_REFUSED);
    const read = await t.request.get(`${BASE}/settings`).set(as(admin));
    expect(read.body.enabled).toBe(false);
  });

  it('A4: bot online → categories resolved and persisted', async () => {
    const ensure = jest
      .spyOn(ops, 'ensureCategory')
      .mockImplementation((_g, o) =>
        Promise.resolve({ id: `cat-${o.name}`, name: o.name, created: true }),
      );
    const res = await t.request
      .patch(`${BASE}/settings`)
      .set(as(admin))
      .send({ enabled: true });
    expect(res.status).toBe(200);
    expect(ensure).toHaveBeenCalledTimes(2);
    expect(res.body).toMatchObject({
      enabled: true,
      gamesCategoryId: 'cat-Games',
      archiveCategoryId: 'cat-Archived',
    });
  });
});

describe('A5/A7 — pinned on bindings', () => {
  it('A5: pinned on a manual binding → 400', async () => {
    const id = await gameBinding(false);
    const res = await t.request
      .patch(`/admin/discord/bindings/${id}`)
      .set(as(admin))
      .send({ pinned: true });
    expect(res.status).toBe(400);
  });

  it('A5/A7: pinned on an auto binding → 200 and listed with the four fields', async () => {
    const id = await gameBinding(true);
    const res = await t.request
      .patch(`/admin/discord/bindings/${id}`)
      .set(as(admin))
      .send({ pinned: true });
    expect(res.status).toBe(200);
    const list = await t.request.get('/admin/discord/bindings').set(as(admin));
    const row = (list.body.data as Array<{ id: string }>).find(
      (b) => b.id === id,
    );
    expect(row).toMatchObject({
      pinned: true,
      autoManaged: true,
      lifecycleState: 'active',
      archivedAt: null,
    });
  });
});

describe('A6 — activity + suppressions', () => {
  it('GET activity mirrors selectGameLifecycleActivity', async () => {
    await gameBinding(true);
    const res = await t.request.get(`${BASE}/activity`).set(as(admin));
    expect(res.status).toBe(200);
    const rows = await selectGameLifecycleActivity(t.db, {
      now: new Date(),
      windowDays: 30,
      guildId: GUILD,
    });
    const ids = (res.body.items as Array<{ gameId: number }>).map(
      (i) => i.gameId,
    );
    expect(ids.sort()).toEqual(rows.map((r) => r.gameId).sort());
  });

  it('DELETE an unknown suppression → 404', async () => {
    const res = await t.request
      .delete(`${BASE}/suppressions/999999`)
      .set(as(admin));
    expect(res.status).toBe(404);
  });
});
